import { In, LessThanOrEqual } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AutoMessageRuleEntity } from "../entity/AutoMessageRule";
import { AutoMessageLogEntity } from "../entity/AutoMessageLog";
import { InboxConversationEntity } from "../entity/InboxConversation";
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
     */
    private async deliver(
        rule: AutoMessageRuleEntity,
        conversation: InboxConversationEntity,
        dedupeKey: string
    ): Promise<"sent" | "failed" | "skipped"> {
        const body = this.renderTemplate(rule.messageTemplate, conversation);
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
            logger.error(`[AutoMessage] rule ${rule.id} delivery failed for thread ${conversation.threadId}: ${err.message}`);
            return "failed";
        }
    }
}
