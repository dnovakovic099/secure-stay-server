import { In, LessThanOrEqual } from "typeorm";
import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AutoMessageRuleEntity } from "../entity/AutoMessageRule";
import { AutoMessageLogEntity } from "../entity/AutoMessageLog";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import { UsersEntity } from "../entity/Users";
import { InboxService } from "./InboxService";

export interface AutoMessageRuleInput {
    name: string;
    enabled?: boolean;
    triggerType: string;
    offsetHours?: number | null;
    offsetDays?: number | null;
    daysOfWeek?: string | null;
    sendTime?: string | null;
    sendAt?: Date | string | null;
    threadId?: number | null;
    listingIds?: string | null;
    channels?: string | null;
    reservationStatuses?: string | null;
    minNights?: number | null;
    maxNights?: number | null;
    skipIfGuestReplied?: boolean;
    messageTemplate: string;
    aiDirective?: string | null;
    aiSkipIfInappropriate?: boolean;
    createdByUserId?: number | null;
    createdByName?: string | null;
}

const TRIGGER_TYPES = [
    "inquiry_winback",
    "before_checkin",
    "after_checkin",
    "before_checkout",
    "after_checkout",
    "day_of_week",
    "one_time",
] as const;

/** Statuses that mean "this is (still) just an inquiry". */
const INQUIRY_STATUSES = ["inquiry", "inquiry_preapproved", "preapproved", "offer", "pending"];

/** Statuses that mean the reservation is dead — never message these. */
const DEAD_STATUSES = [
    "cancelled", "canceled", "declined", "denied", "expired", "withdrawn",
    "deleted", "noshow", "inquiry_denied", "inquiry_timedout", "inquiry_not_possible",
    "timedout", "not_possible",
];

/**
 * AutoMessageService — rule-based automated guest messaging.
 *
 * Staff define rules (inquiry winback, pre-arrival reminders, trash-day /
 * day-of-week notes, one-off follow-ups); processDueMessages() runs on a cron,
 * matches conversations, renders the template, and delivers through the normal
 * inbox pipeline (InboxService.sendAutomatedReply → Hostify).
 *
 * Safety:
 *  - every rule starts DISABLED; staff must enable it explicitly
 *  - AUTO_MESSAGES_ENABLED=false is a global kill switch
 *  - unique (rule, thread, occurrence) log rows make delivery idempotent
 *  - by default a rule skips threads where the guest is awaiting a reply
 *    (skipIfGuestReplied) so canned sends never bury a real question
 */
export class AutoMessageService {
    private ruleRepo = appDatabase.getRepository(AutoMessageRuleEntity);
    private logRepo = appDatabase.getRepository(AutoMessageLogEntity);
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);

    /** Global kill switch. On unless explicitly disabled. */
    static isEnabled(): boolean {
        return String(process.env.AUTO_MESSAGES_ENABLED || "true").toLowerCase() !== "false";
    }

    // -------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------

    async list(opts: { includeDisabled?: boolean } = {}) {
        const where: any = {};
        if (!opts.includeDisabled) where.enabled = 1;
        const rules = await this.ruleRepo.find({
            where: opts.includeDisabled ? {} : where,
            order: { createdAt: "DESC" },
        });
        // Sent counts per rule for the list view.
        const counts = await this.logRepo
            .createQueryBuilder("l")
            .select("l.ruleId", "ruleId")
            .addSelect("SUM(l.status = 'sent')", "sent")
            .addSelect("SUM(l.status = 'failed')", "failed")
            .groupBy("l.ruleId")
            .getRawMany();
        const byRule = new Map(counts.map((c: any) => [Number(c.ruleId), c]));
        return rules.map((r) => ({
            ...r,
            sentCount: Number(byRule.get(r.id)?.sent) || 0,
            failedCount: Number(byRule.get(r.id)?.failed) || 0,
        }));
    }

    async create(input: AutoMessageRuleInput): Promise<AutoMessageRuleEntity> {
        this.validate(input);
        const rule = this.ruleRepo.create({
            name: input.name.trim().slice(0, 255),
            enabled: input.enabled ? 1 : 0,
            triggerType: input.triggerType,
            offsetHours: input.offsetHours ?? null,
            offsetDays: input.offsetDays ?? null,
            daysOfWeek: input.daysOfWeek || null,
            sendTime: input.sendTime || null,
            sendAt: input.sendAt ? new Date(input.sendAt) : null,
            threadId: input.threadId ?? null,
            listingIds: input.listingIds || null,
            channels: input.channels || null,
            reservationStatuses: input.reservationStatuses || null,
            minNights: input.minNights ?? null,
            maxNights: input.maxNights ?? null,
            skipIfGuestReplied: input.skipIfGuestReplied === false ? 0 : 1,
            messageTemplate: input.messageTemplate,
            aiDirective: input.aiDirective?.trim() ? input.aiDirective.trim().slice(0, 4000) : null,
            aiSkipIfInappropriate: input.aiSkipIfInappropriate ? 1 : 0,
            createdByUserId: input.createdByUserId ?? null,
            createdByName: input.createdByName ?? null,
        });
        return this.ruleRepo.save(rule);
    }

    async update(id: number, patch: Partial<AutoMessageRuleInput>): Promise<AutoMessageRuleEntity> {
        const rule = await this.ruleRepo.findOne({ where: { id } });
        if (!rule) throw new Error(`Auto-message rule ${id} not found`);
        const merged: AutoMessageRuleInput = {
            name: patch.name ?? rule.name,
            triggerType: patch.triggerType ?? rule.triggerType,
            messageTemplate: patch.messageTemplate ?? rule.messageTemplate,
            offsetHours: patch.offsetHours !== undefined ? patch.offsetHours : rule.offsetHours,
            offsetDays: patch.offsetDays !== undefined ? patch.offsetDays : rule.offsetDays,
            daysOfWeek: patch.daysOfWeek !== undefined ? patch.daysOfWeek : rule.daysOfWeek,
            sendTime: patch.sendTime !== undefined ? patch.sendTime : rule.sendTime,
            sendAt: patch.sendAt !== undefined ? patch.sendAt : rule.sendAt,
            threadId: patch.threadId !== undefined ? patch.threadId : rule.threadId,
            aiDirective: patch.aiDirective !== undefined ? patch.aiDirective : rule.aiDirective,
            aiSkipIfInappropriate:
                patch.aiSkipIfInappropriate !== undefined
                    ? patch.aiSkipIfInappropriate
                    : !!rule.aiSkipIfInappropriate,
        };
        this.validate(merged);

        rule.name = merged.name.trim().slice(0, 255);
        rule.triggerType = merged.triggerType;
        rule.messageTemplate = merged.messageTemplate;
        rule.offsetHours = merged.offsetHours ?? null;
        rule.offsetDays = merged.offsetDays ?? null;
        rule.daysOfWeek = merged.daysOfWeek || null;
        rule.sendTime = merged.sendTime || null;
        rule.sendAt = merged.sendAt ? new Date(merged.sendAt) : null;
        rule.threadId = merged.threadId ?? null;
        if (patch.enabled !== undefined) rule.enabled = patch.enabled ? 1 : 0;
        if (patch.listingIds !== undefined) rule.listingIds = patch.listingIds || null;
        if (patch.channels !== undefined) rule.channels = patch.channels || null;
        if (patch.reservationStatuses !== undefined) rule.reservationStatuses = patch.reservationStatuses || null;
        if (patch.minNights !== undefined) rule.minNights = patch.minNights ?? null;
        if (patch.maxNights !== undefined) rule.maxNights = patch.maxNights ?? null;
        if (patch.skipIfGuestReplied !== undefined) rule.skipIfGuestReplied = patch.skipIfGuestReplied ? 1 : 0;
        if (patch.aiDirective !== undefined) {
            rule.aiDirective = patch.aiDirective?.trim() ? patch.aiDirective.trim().slice(0, 4000) : null;
        }
        if (patch.aiSkipIfInappropriate !== undefined) {
            rule.aiSkipIfInappropriate = patch.aiSkipIfInappropriate ? 1 : 0;
        }
        return this.ruleRepo.save(rule);
    }

    async remove(id: number): Promise<boolean> {
        const res = await this.ruleRepo.delete({ id });
        return (res.affected || 0) > 0;
    }

    async listLogs(opts: { ruleId?: number; threadId?: number; limit?: number } = {}) {
        const where: any = {};
        if (opts.ruleId) where.ruleId = opts.ruleId;
        if (opts.threadId) where.threadId = opts.threadId;
        return this.logRepo.find({
            where,
            order: { createdAt: "DESC" },
            take: Math.min(Math.max(opts.limit || 100, 1), 500),
        });
    }

    private validate(input: AutoMessageRuleInput) {
        if (!input.name?.trim()) throw new Error("Rule name is required");
        if (!input.messageTemplate?.trim()) throw new Error("Message template is required");
        if (!TRIGGER_TYPES.includes(input.triggerType as any)) {
            throw new Error(`Invalid triggerType: ${input.triggerType}`);
        }
        if (input.triggerType === "inquiry_winback" && !(Number(input.offsetHours) > 0)) {
            throw new Error("Inquiry winback needs offsetHours > 0");
        }
        if (
            ["before_checkin", "after_checkin", "before_checkout", "after_checkout"].includes(input.triggerType) &&
            (input.offsetDays == null || Number(input.offsetDays) < 0)
        ) {
            throw new Error("Check-in/out triggers need offsetDays >= 0");
        }
        if (input.triggerType === "day_of_week" && !String(input.daysOfWeek || "").trim()) {
            throw new Error("Day-of-week trigger needs daysOfWeek (CSV of 0-6)");
        }
        if (input.triggerType === "one_time") {
            if (!input.sendAt) throw new Error("One-time message needs sendAt");
            if (!input.threadId) throw new Error("One-time message needs threadId");
        }
        if (input.sendTime && !/^\d{2}:\d{2}$/.test(input.sendTime)) {
            throw new Error("sendTime must be HH:MM (24h)");
        }
    }

    // -------------------------------------------------------------------------
    // Engine
    // -------------------------------------------------------------------------

    /** Current date parts in America/New_York. */
    private nowEt(): { dateKey: string; weekday: number; hhmm: string } {
        const now = new Date();
        const dateKey = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(now);
        const weekdayName = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York", weekday: "short",
        }).format(now);
        const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
        const hhmm = new Intl.DateTimeFormat("en-GB", {
            timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(now);
        return { dateKey, weekday, hhmm };
    }

    private shiftDateKey(dateKey: string, days: number): string {
        const [y, m, d] = dateKey.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + days);
        return dt.toISOString().slice(0, 10);
    }

    private csv(value: string | null | undefined): string[] {
        return String(value || "")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
    }

    private renderTemplate(template: string, c: InboxConversationEntity): string {
        const guestName = (c.guestName || "there").trim();
        const firstName = guestName.split(/\s+/)[0] || "there";
        return template
            .replace(/\{\{\s*guest_name\s*\}\}/gi, guestName)
            .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
            .replace(/\{\{\s*listing_name\s*\}\}/gi, c.listingName || "the property")
            .replace(/\{\{\s*checkin\s*\}\}/gi, c.checkin || "")
            .replace(/\{\{\s*checkout\s*\}\}/gi, c.checkout || "")
            .replace(/\{\{\s*nights\s*\}\}/gi, c.nights != null ? String(c.nights) : "")
            .trim();
    }

    /** Shared per-conversation filters (scope, channel, stay length, pending question). */
    private matchesFilters(rule: AutoMessageRuleEntity, c: InboxConversationEntity): boolean {
        if (c.isArchived) return false;
        const listingIds = this.csv(rule.listingIds);
        if (listingIds.length && (!c.listingId || !listingIds.includes(String(c.listingId)))) return false;
        const channels = this.csv(rule.channels);
        if (channels.length && !channels.includes(String(c.channel || "").toLowerCase())) return false;
        if (rule.minNights != null && (c.nights == null || c.nights < rule.minNights)) return false;
        if (rule.maxNights != null && (c.nights == null || c.nights > rule.maxNights)) return false;
        // Never blast a thread where the guest is waiting on an answer.
        if (rule.skipIfGuestReplied && Number(c.answered) === 0 && rule.triggerType !== "inquiry_winback") return false;
        const status = String(c.reservationStatus || "").toLowerCase().replace(/[\s-]/g, "_");
        if (DEAD_STATUSES.includes(status)) return false;
        const wanted = this.csv(rule.reservationStatuses).map((s) => s.replace(/[\s-]/g, "_"));
        if (wanted.length && !wanted.includes(status)) return false;
        return true;
    }

    /**
     * Evaluate every enabled rule and deliver anything due. Called by the cron
     * (and by the manual "Run now" endpoint). Never throws.
     */
    async processDueMessages(): Promise<{ evaluated: number; sent: number; failed: number; skipped: number }> {
        const result = { evaluated: 0, sent: 0, failed: 0, skipped: 0 };
        if (!AutoMessageService.isEnabled()) return result;

        let rules: AutoMessageRuleEntity[] = [];
        try {
            rules = await this.ruleRepo.find({ where: { enabled: 1 } });
        } catch (err: any) {
            logger.error(`[AutoMessage] failed to load rules: ${err.message}`);
            return result;
        }
        if (!rules.length) return result;

        const et = this.nowEt();
        for (const rule of rules) {
            result.evaluated++;
            try {
                const due = await this.findDueConversations(rule, et);
                for (const { conversation, dedupeKey } of due) {
                    const ok = await this.deliver(rule, conversation, dedupeKey);
                    if (ok === "sent") result.sent++;
                    else if (ok === "failed") result.failed++;
                    else result.skipped++;
                }
                // One-time rules disable themselves after delivery.
                if (rule.triggerType === "one_time" && due.length) {
                    rule.enabled = 0;
                    await this.ruleRepo.save(rule);
                }
            } catch (err: any) {
                logger.error(`[AutoMessage] rule ${rule.id} (${rule.name}) failed: ${err.message}`);
            }
        }
        if (result.sent || result.failed) {
            logger.info(
                `[AutoMessage] sweep complete — evaluated=${result.evaluated} sent=${result.sent} ` +
                `failed=${result.failed} skipped=${result.skipped}`
            );
        }
        return result;
    }

    private timeReached(rule: AutoMessageRuleEntity, hhmm: string): boolean {
        return !rule.sendTime || hhmm >= rule.sendTime;
    }

    private async findDueConversations(
        rule: AutoMessageRuleEntity,
        et: { dateKey: string; weekday: number; hhmm: string }
    ): Promise<{ conversation: InboxConversationEntity; dedupeKey: string }[]> {
        switch (rule.triggerType) {
            case "one_time": {
                if (!rule.threadId || !rule.sendAt || new Date(rule.sendAt) > new Date()) return [];
                const c = await this.conversationRepo.findOne({ where: { threadId: rule.threadId } });
                // One-time sends are explicit staff intent: only the archived check applies.
                if (!c || c.isArchived) return [];
                return [{ conversation: c, dedupeKey: "once" }];
            }

            case "inquiry_winback": {
                if (!this.timeReached(rule, et.hhmm)) return [];
                const silenceMs = (rule.offsetHours || 24) * 3600 * 1000;
                const cutoff = new Date(Date.now() - silenceMs);
                const statuses = this.csv(rule.reservationStatuses);
                const wanted = statuses.length ? statuses : INQUIRY_STATUSES;
                const candidates = await this.conversationRepo.find({
                    where: {
                        isArchived: 0,
                        reservationStatus: In(wanted),
                        lastMessageAt: LessThanOrEqual(cutoff),
                    },
                    take: 500,
                });
                return candidates
                    .filter((c) => this.matchesFilters(rule, c))
                    // Don't winback inquiries whose requested dates already passed.
                    .filter((c) => !c.checkin || c.checkin >= et.dateKey)
                    .map((c) => ({ conversation: c, dedupeKey: "once" }));
            }

            case "day_of_week": {
                const days = this.csv(rule.daysOfWeek).map(Number);
                if (!days.includes(et.weekday) || !this.timeReached(rule, et.hhmm)) return [];
                // Guests currently mid-stay.
                const candidates = await this.conversationRepo
                    .createQueryBuilder("c")
                    .where("c.isArchived = 0")
                    .andWhere("c.checkin <= :today", { today: et.dateKey })
                    .andWhere("c.checkout > :today", { today: et.dateKey })
                    .take(500)
                    .getMany();
                return candidates
                    .filter((c) => this.matchesFilters(rule, c))
                    .map((c) => ({ conversation: c, dedupeKey: et.dateKey }));
            }

            case "before_checkin":
            case "after_checkin":
            case "before_checkout":
            case "after_checkout": {
                if (!this.timeReached(rule, et.hhmm)) return [];
                const offset = rule.offsetDays || 0;
                const anchorField = rule.triggerType.includes("checkin") ? "checkin" : "checkout";
                // before_X: anchor is offset days in the future; after_X: offset days in the past.
                const targetAnchor = rule.triggerType.startsWith("before")
                    ? this.shiftDateKey(et.dateKey, offset)
                    : this.shiftDateKey(et.dateKey, -offset);
                const candidates = await this.conversationRepo
                    .createQueryBuilder("c")
                    .where("c.isArchived = 0")
                    .andWhere(`c.${anchorField} = :target`, { target: targetAnchor })
                    .andWhere("c.reservationStatus NOT IN (:...dead)", { dead: DEAD_STATUSES })
                    .take(500)
                    .getMany();
                return candidates
                    .filter((c) => this.matchesFilters(rule, c))
                    .map((c) => ({ conversation: c, dedupeKey: et.dateKey }));
            }

            default:
                return [];
        }
    }

    /**
     * Idempotent delivery: claim the (rule, thread, occurrence) slot by inserting
     * the log row first — the unique index rejects duplicates — then send.
     * When aiDirective / aiSkipIfInappropriate is set, rewrites (or aborts) using
     * the live conversation at send time.
     */
    private async deliver(
        rule: AutoMessageRuleEntity,
        conversation: InboxConversationEntity,
        dedupeKey: string
    ): Promise<"sent" | "failed" | "skipped"> {
        let body = this.renderTemplate(rule.messageTemplate, conversation);
        if (!body) return "skipped";

        let log: AutoMessageLogEntity;
        try {
            log = await this.logRepo.save(
                this.logRepo.create({
                    ruleId: rule.id,
                    threadId: conversation.threadId,
                    dedupeKey,
                    status: "sending",
                    messageBody: body,
                })
            );
        } catch {
            // Unique-index hit: already sent (or currently sending) this occurrence.
            return "skipped";
        }

        const wantsAi =
            !!String(rule.aiDirective || "").trim() || !!Number(rule.aiSkipIfInappropriate);
        if (wantsAi) {
            try {
                const adapted = await this.adaptMessageAtSendTime(rule, conversation, body);
                if (!adapted.proceed) {
                    const reason =
                        adapted.skipReason ||
                        "Scheduled message no longer fits the conversation context.";
                    log.status = "skipped";
                    log.error = reason.slice(0, 2000);
                    log.messageBody = body;
                    await this.logRepo.save(log);
                    await this.recordScheduleSkipInThread(conversation, rule, reason);
                    await this.notifyScheduleSkip(rule, conversation, reason);
                    logger.info(
                        `[AutoMessage] rule ${rule.id} skipped for thread ${conversation.threadId}: ${reason}`
                    );
                    return "skipped";
                }
                if (adapted.body?.trim()) {
                    body = adapted.body.trim();
                    log.messageBody = body;
                    await this.logRepo.save(log);
                }
            } catch (adaptErr: any) {
                // Fail open: send the original template if the AI pass errors.
                logger.warn(
                    `[AutoMessage] rule ${rule.id} AI adapt failed thread=${conversation.threadId}: ${adaptErr?.message}`
                );
            }
        }

        try {
            await new InboxService().sendAutomatedReply(conversation.threadId, body, {
                senderName: `Automated · ${rule.name}`.slice(0, 100),
            });
            log.status = "sent";
            log.sentAt = new Date();
            await this.logRepo.save(log);
            logger.info(`[AutoMessage] rule ${rule.id} sent to thread ${conversation.threadId} (${dedupeKey})`);
            return "sent";
        } catch (err: any) {
            log.status = "failed";
            log.error = String(err.message || err).slice(0, 2000);
            await this.logRepo.save(log);
            await this.notifyScheduleSkip(
                rule,
                conversation,
                `Scheduled message failed to send: ${String(err.message || err).slice(0, 240)}`,
                "failed"
            );
            logger.error(
                `[AutoMessage] rule ${rule.id} delivery failed for thread ${conversation.threadId}: ${err.message}`
            );
            return "failed";
        }
    }

    private async adaptMessageAtSendTime(
        rule: AutoMessageRuleEntity,
        conversation: InboxConversationEntity,
        draftBody: string
    ): Promise<{ proceed: boolean; body?: string; skipReason?: string }> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return { proceed: true, body: draftBody };

        const messageRepo = appDatabase.getRepository(InboxMessageEntity);
        const recent = await messageRepo.find({
            where: { threadId: Number(conversation.threadId) },
            order: { sentAt: "DESC", id: "DESC" },
            take: 16,
        });
        const transcript = [...recent]
            .reverse()
            .map((m) => {
                const who =
                    m.direction === "incoming"
                        ? "GUEST"
                        : m.direction === "system"
                          ? "SYSTEM"
                          : Number(m.isAutomatic)
                            ? "AUTO"
                            : "HOST";
                const text = String(m.body || m.note || "")
                    .replace(/\s+/g, " ")
                    .trim();
                return text ? `${who}: ${text.slice(0, 400)}` : null;
            })
            .filter(Boolean)
            .join("\n");

        const allowSkip = !!Number(rule.aiSkipIfInappropriate);
        const directive = String(rule.aiDirective || "").trim();
        const client = new OpenAI({ apiKey });
        const model = process.env.AI_MODEL || "gpt-4.1";
        const resp = await client.chat.completions.create({
            model,
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: [
                        "You prepare a scheduled guest message for a short-term rental inbox.",
                        "Rewrite the DRAFT so it fits the CURRENT conversation at send time.",
                        "Keep the same intent as the draft + staff directive. Be concise, warm, and guest-ready.",
                        "Do not invent fees, codes, approvals, or availability that are not in the draft/directive/thread.",
                        allowSkip
                            ? 'If sending would be contextually inappropriate now (guest already answered, issue resolved, booking cancelled, message would confuse/annoy, topic no longer relevant), set proceed=false and explain why.'
                            : "Always set proceed=true. Still tailor the wording to the latest thread context.",
                        'Return STRICT JSON: {"proceed":true|false,"message":"<final guest message or empty if not proceeding>","skip_reason":"<short reason if proceed=false>"}',
                    ].join("\n"),
                },
                {
                    role: "user",
                    content: [
                        `Guest: ${conversation.guestName || "Guest"}`,
                        `Listing: ${conversation.listingName || "—"}`,
                        `Status: ${conversation.reservationStatus || "—"}`,
                        `Stay: ${conversation.checkin || "?"} → ${conversation.checkout || "?"}`,
                        directive ? `STAFF DIRECTIVE:\n${directive}` : "STAFF DIRECTIVE: (none — tailor draft to thread)",
                        `DRAFT MESSAGE:\n${draftBody}`,
                        `RECENT THREAD (oldest→newest):\n${transcript || "(no recent messages)"}`,
                    ].join("\n\n"),
                },
            ],
        });

        const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
        const proceed = parsed.proceed !== false;
        if (!proceed) {
            if (!allowSkip) {
                return { proceed: true, body: draftBody };
            }
            return {
                proceed: false,
                skipReason: String(parsed.skip_reason || parsed.skipReason || "Contextually inappropriate").slice(
                    0,
                    500
                ),
            };
        }
        const message = String(parsed.message || "").trim();
        return { proceed: true, body: message || draftBody };
    }

    /** Local system bubble so the thread shows why a scheduled send aborted. */
    private async recordScheduleSkipInThread(
        conversation: InboxConversationEntity,
        rule: AutoMessageRuleEntity,
        reason: string
    ): Promise<void> {
        try {
            const messageRepo = appDatabase.getRepository(InboxMessageEntity);
            const body = `Scheduled message not sent: ${reason}`.slice(0, 2000);
            const msg = messageRepo.create({
                externalId: -Math.abs(Date.now() * 1000 + (rule.id % 1000)),
                threadId: Number(conversation.threadId),
                reservationId: conversation.reservationId,
                listingId: conversation.listingId,
                body,
                note: null,
                direction: "system",
                senderType: "system",
                senderName: "Scheduled message",
                isAutomatic: 1,
                isSms: 0,
                channel: conversation.channel,
                attachmentUrl: null,
                guestId: conversation.guestId,
                sentAt: new Date(),
                sentByUserId: null,
                sentByName: rule.createdByName || "System",
                sentVia: "auto_message_skip",
                source: "hostify",
            });
            await messageRepo.save(msg);
            conversation.lastMessageText = body;
            conversation.lastMessageAt = msg.sentAt;
            await this.conversationRepo.save(conversation);
        } catch (err: any) {
            logger.warn(
                `[AutoMessage] failed to write skip system message thread=${conversation.threadId}: ${err?.message}`
            );
        }
    }

    private async notifyScheduleSkip(
        rule: AutoMessageRuleEntity,
        conversation: InboxConversationEntity,
        reason: string,
        kind: "skipped" | "failed" = "skipped"
    ): Promise<void> {
        try {
            if (!rule.createdByUserId) return;
            const user = await appDatabase.getRepository(UsersEntity).findOne({
                where: { id: Number(rule.createdByUserId) },
            });
            const userUid = String(user?.uid || "").trim();
            if (!userUid) return;

            const guest = conversation.guestName || "Guest";
            const listing = conversation.listingName || "listing";
            const href = `/messages/inbox-v2?thread=${conversation.threadId}`;
            const title =
                kind === "failed"
                    ? `Scheduled message failed · ${guest}`
                    : `Scheduled message skipped · ${guest}`;
            const body = [
                reason,
                `Listing: ${listing}`,
                rule.name ? `Rule: ${rule.name}` : null,
            ]
                .filter(Boolean)
                .join("\n")
                .slice(0, 2000);

            const repo = appDatabase.getRepository(UserDirectedNotificationEntity);
            await repo.save(
                repo.create({
                    userUid,
                    actorUid: null,
                    actorName: "Scheduler",
                    type: "scheduled_message",
                    title,
                    body,
                    href,
                    threadId: Number(conversation.threadId),
                    messageExternalId: null,
                    escalationId: null,
                    readAt: null,
                })
            );
        } catch (err: any) {
            logger.warn(`[AutoMessage] schedule notification failed: ${err?.message}`);
        }
    }
}
