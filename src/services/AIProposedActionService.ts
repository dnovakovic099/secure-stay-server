import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIProposedActionEntity } from "../entity/AIProposedAction";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ActionItems } from "../entity/ActionItems";
import { Hostify } from "../client/Hostify";

/**
 * AIProposedActionService
 *
 * Turns what the AI already detects in guest messages into concrete one-click
 * actions a human approves from the inbox. The AI proposes; staff execute.
 *
 * Detection is deterministic (keywords + live data joins) and runs after a
 * suggestion is generated for an inbound guest message. Each proposal carries
 * its evidence (live calendar, programmed lock code, guest quote) so the
 * approver can verify at a glance.
 */

const LATE_CHECKOUT_RE =
    /\b(late|extended?)[\s-]*check[\s-]*out\b|\bcheck[\s-]*out\s+(late|later|a little later|an hour later)\b|\bstay\s+(an hour|a bit|a little)\s+(longer|later)\b.*\bcheck/i;
const EARLY_CHECKIN_RE =
    /\bearly[\s-]*check[\s-]*in\b|\bcheck[\s-]*in\s+(early|earlier)\b|\barrive\s+(early|earlier|before)\b|\bget\s+in\s+early\b|\bdrop\s+(our|my|the)\s+(bags|luggage)\b/i;
const LOCKOUT_RE =
    /\block(ed)?\s*out\b|\b(code|keypad|lock|door)\b[^.!?\n]{0,40}\b(not|isn'?t|doesn'?t|won'?t|wont|stopped)\s*work|\bcan'?t\s+(get|figure)\s+(in|inside|the door)|\bunable\s+to\s+(get|enter)\b|\bdoor\s+(won'?t|wont|will not)\s+open\b|\bwrong\s+code\b|\bcode\s+(is\s+)?(invalid|incorrect|wrong)\b/i;
const OPS_ISSUE_RE =
    /\b(broken?|not working|doesn'?t work|stopped working|leak(ing|s)?|clog(ged)?|no hot water|no water|no power|no electricity|won'?t turn on|wifi.{0,20}(down|out|not)|internet.{0,20}(down|out|not)|a\/?c.{0,20}(not|broken|out)|heat(er|ing)?.{0,20}(not|broken|out)|dirty|wasn'?t clean|not clean|smell|stain(ed)?|bugs?|roach|mice|mold|out of (toilet paper|towels|soap|paper towels|coffee)|ran out of|missing)\b/i;

export interface ProposedActionInput {
    conversation: InboxConversationEntity;
    guestMessage: InboxMessageEntity | null;
    suggestion: AIMessageSuggestionEntity;
}

export class AIProposedActionService {
    private repo = appDatabase.getRepository(AIProposedActionEntity);
    private hostify = new Hostify();

    private get hostifyApiKey(): string {
        return process.env.HOSTIFY_API_KEY as string;
    }

    static isEnabled(): boolean {
        // Piggybacks on the assistant master switch; no extra env needed.
        return String(process.env.AI_MESSAGING_ENABLED || "").toLowerCase() === "true";
    }

    // ------------------------------------------------------------------
    // Detection
    // ------------------------------------------------------------------

    /**
     * Detect and persist proposals for an inbound guest message. Idempotent per
     * (thread, actionType): an existing open proposal of the same type blocks a
     * duplicate. Never throws — best-effort, fire-and-forget from callers.
     */
    async detectForMessage(input: ProposedActionInput): Promise<AIProposedActionEntity[]> {
        const created: AIProposedActionEntity[] = [];
        try {
            const text = String(input.guestMessage?.body || "").trim();
            if (!text) return created;

            // Cheap regex screen first — only hit the DB when something matched.
            const matchedAny =
                LATE_CHECKOUT_RE.test(text) ||
                EARLY_CHECKIN_RE.test(text) ||
                LOCKOUT_RE.test(text) ||
                OPS_ISSUE_RE.test(text);
            if (!matchedAny) return created;

            const open = await this.repo.find({
                where: { threadId: Number(input.conversation.threadId), status: "proposed" },
            });
            const hasOpen = (type: string) => open.some((a) => a.actionType === type);

            if (LATE_CHECKOUT_RE.test(text) && !hasOpen("late_checkout")) {
                const a = await this.proposeScheduleChange(input, "late_checkout", text);
                if (a) created.push(a);
            }
            if (EARLY_CHECKIN_RE.test(text) && !hasOpen("early_check_in")) {
                const a = await this.proposeScheduleChange(input, "early_check_in", text);
                if (a) created.push(a);
            }
            if (LOCKOUT_RE.test(text) && !hasOpen("resend_access_code")) {
                const a = await this.proposeAccessCodeResend(input, text);
                if (a) created.push(a);
            }
            if (OPS_ISSUE_RE.test(text) && !hasOpen("create_ops_ticket")) {
                const a = await this.proposeOpsTicket(input, text);
                if (a) created.push(a);
            }
        } catch (err: any) {
            logger.warn(`[AIProposedAction] detection failed (thread ${input.conversation.threadId}): ${err.message}`);
        }
        return created;
    }

    /**
     * Late checkout / early check-in: fetch the live calendar night that the
     * request hinges on and attach it as evidence. Proposed either way (the
     * team decides); the evidence states whether the night is open.
     */
    private async proposeScheduleChange(
        input: ProposedActionInput,
        type: "late_checkout" | "early_check_in",
        guestText: string
    ): Promise<AIProposedActionEntity | null> {
        const conv = input.conversation;
        if (!conv.listingId) return null;
        const dateStr = type === "late_checkout" ? conv.checkout : conv.checkin;
        if (!dateStr) return null;

        // The night that must be free: checkout day itself for late checkout,
        // the night before arrival for early check-in.
        const keyDate = new Date(String(dateStr));
        if (isNaN(keyDate.getTime())) return null;
        if (type === "early_check_in") keyDate.setDate(keyDate.getDate() - 1);
        const key = keyDate.toISOString().slice(0, 10);

        let nightOpen: boolean | null = null;
        if (this.hostifyApiKey) {
            try {
                const days = await this.hostify.getCalendar(this.hostifyApiKey, Number(conv.listingId), key, key);
                const day = (days || []).find((d: any) => String(d.date).slice(0, 10) === key);
                if (day) nightOpen = String(day.status || "").toLowerCase() === "available";
            } catch {
                /* evidence stays unknown */
            }
        }

        const label = type === "late_checkout" ? "late checkout" : "early check-in";
        const evidence =
            nightOpen === true
                ? `Live calendar: the night of ${key} is OPEN — no back-to-back turnover conflict.`
                : nightOpen === false
                ? `Live calendar: the night of ${key} is NOT open — likely a same-day turnover. Approve only if cleaning allows.`
                : `Live calendar unavailable — check the ${key} night before approving.`;

        // Only promise outright when the calendar confirms the night is open;
        // otherwise the default reply defers to housekeeping (staff can edit).
        const guestFirst = (conv.guestName || "").split(" ")[0] || "there";
        const proposedReply =
            nightOpen === true
                ? type === "late_checkout"
                    ? `Good news ${guestFirst}, we can do a late checkout for you. Take your time and let us know if you need anything else!`
                    : `Good news ${guestFirst}, we can get you in early. We'll confirm the exact time as soon as the place is ready!`
                : type === "late_checkout"
                ? `Hi ${guestFirst}, we'd love to help with a late checkout — let us check the cleaning schedule and we'll confirm shortly!`
                : `Hi ${guestFirst}, we'd love to get you in early — let us check with housekeeping and we'll confirm as soon as we can!`;

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion.id,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId: input.guestMessage ? Number(input.guestMessage.externalId) : null,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: type,
                title:
                    nightOpen === true
                        ? `Approve ${label}? The ${key} night is open.`
                        : `Guest asked for ${label} (${key} night ${nightOpen === false ? "NOT open" : "unverified"}).`,
                evidence: `${evidence}\nGuest said: "${guestText.slice(0, 200)}"`,
                proposedReply,
                taskDescription: `${type === "late_checkout" ? "Late checkout" : "Early check-in"} approved for ${conv.guestName || "guest"} (${conv.listingName || "listing " + conv.listingId}) — update the cleaning schedule.`,
                payload: JSON.stringify({ nightDate: key, nightOpen, guestQuote: guestText.slice(0, 500) }),
                status: "proposed",
            })
        );
    }

    /** Lockout: attach the live programmed code as evidence and offer a one-click resend. */
    private async proposeAccessCodeResend(
        input: ProposedActionInput,
        guestText: string
    ): Promise<AIProposedActionEntity | null> {
        const conv = input.conversation;
        const resvId = conv.reservationId ? Number(conv.reservationId) : null;
        if (!resvId) return null;

        const rows: any[] = await appDatabase
            .query(
                `SELECT ac.code, ac.code_name, d.device_name, d.location_name
                 FROM access_codes ac
                 LEFT JOIN smart_lock_devices d ON d.id = ac.device_id
                 WHERE ac.reservation_id = ? AND ac.status = 'set'
                 ORDER BY ac.set_at DESC LIMIT 1`,
                [resvId]
            )
            .catch(() => []);
        if (!rows.length || !rows[0]?.code) return null;

        const code = String(rows[0].code);
        const where = [rows[0].device_name, rows[0].location_name].filter(Boolean).join(", ");
        const guestFirst = (conv.guestName || "").split(" ")[0] || "there";
        const proposedReply =
            `So sorry about the trouble, ${guestFirst}! Your door code is ${code} — ` +
            `enter it on the keypad${where ? ` (${where})` : ""} and press # if the lock has one. ` +
            `If it still doesn't work, message us right away and we'll get you in.`;

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion.id,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId: input.guestMessage ? Number(input.guestMessage.externalId) : null,
                reservationId: resvId,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: "resend_access_code",
                title: "Guest may be locked out — resend the live door code?",
                evidence: `Live code programmed on the smart lock: ${code}${where ? ` (${where})` : ""}.\nGuest said: "${guestText.slice(0, 200)}"`,
                proposedReply,
                payload: JSON.stringify({ code, device: where || null, guestQuote: guestText.slice(0, 500) }),
                status: "proposed",
            })
        );
    }

    /**
     * Ops ticket: the guest reported a problem. Pre-fill an action item from
     * the suggestion's own suggested_action_items when available, else from
     * the guest's words.
     */
    private async proposeOpsTicket(
        input: ProposedActionInput,
        guestText: string
    ): Promise<AIProposedActionEntity | null> {
        const conv = input.conversation;
        let taskText: string | null = null;
        try {
            const items = JSON.parse(input.suggestion.suggestedActionItems || "[]");
            if (Array.isArray(items) && items.length) taskText = items.map(String).join("; ").slice(0, 500);
        } catch {
            /* fall through */
        }
        if (!taskText) {
            taskText = `Guest reported: "${guestText.slice(0, 300)}" — investigate and resolve.`;
        }

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion.id,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId: input.guestMessage ? Number(input.guestMessage.externalId) : null,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: "create_ops_ticket",
                title: "Guest reported a problem — create a maintenance/ops task?",
                evidence: `Guest said: "${guestText.slice(0, 300)}"`,
                proposedReply: null,
                taskDescription: taskText,
                payload: JSON.stringify({ guestQuote: guestText.slice(0, 500) }),
                status: "proposed",
            })
        );
    }

    // ------------------------------------------------------------------
    // Read / execute / dismiss
    // ------------------------------------------------------------------

    async listForThread(threadId: number, opts: { includeResolved?: boolean } = {}) {
        const where: any = { threadId };
        if (!opts.includeResolved) where.status = "proposed";
        return this.repo.find({ where, order: { createdAt: "DESC" } });
    }

    async listRecent(opts: { status?: string; limit?: number } = {}) {
        const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
        const where: any = {};
        if (opts.status) where.status = opts.status;
        else where.status = In(["proposed", "executed", "dismissed"]);
        return this.repo.find({ where, order: { createdAt: "DESC" }, take: limit });
    }

    /**
     * Execute an approved action. `replyOverride` lets the approver edit the
     * guest-facing text before it goes out. Attribution goes to the approver.
     */
    async execute(
        id: number,
        user: any,
        opts: { replyOverride?: string | null; taskOverride?: string | null } = {}
    ): Promise<AIProposedActionEntity> {
        const action = await this.repo.findOne({ where: { id } });
        if (!action) throw new Error(`Proposed action ${id} not found`);
        if (action.status !== "proposed") throw new Error(`Action ${id} is already ${action.status}`);

        const results: string[] = [];

        // 1) Guest-facing reply (schedule changes + code resend).
        const reply = (opts.replyOverride ?? action.proposedReply ?? "").trim();
        if (reply) {
            const { InboxService } = await import("./InboxService");
            await new InboxService().sendReply(Number(action.threadId), reply, user);
            results.push("reply sent to guest");
        }

        // 2) Internal task (ops ticket always; schedule changes create a
        //    turnover-schedule task so cleaning is informed).
        const taskText = (opts.taskOverride ?? action.taskDescription ?? "").trim();
        if (taskText && (action.actionType === "create_ops_ticket" || action.actionType === "late_checkout" || action.actionType === "early_check_in")) {
            const actionItemsRepo = appDatabase.getRepository(ActionItems);
            const conv = await appDatabase
                .getRepository(InboxConversationEntity)
                .findOne({ where: { threadId: Number(action.threadId) } })
                .catch(() => null);
            const saved = await actionItemsRepo.save(
                actionItemsRepo.create({
                    item: taskText,
                    category:
                        action.actionType === "create_ops_ticket" ? "Maintenance" : "Guest Request",
                    status: "incomplete",
                    urgency: action.actionType === "create_ops_ticket" ? 2 : 1,
                    guestName: conv?.guestName || null,
                    listingId: action.listingId ? Number(action.listingId) : null,
                    listingName: conv?.listingName || null,
                    reservationId: action.reservationId ? Number(action.reservationId) : null,
                    createdBy: "inbox-ai-action",
                    source: "inbox_ai",
                } as Partial<ActionItems>)
            );
            results.push(`task #${saved.id} created`);
        }

        action.status = "executed";
        action.resultNote = results.join("; ").slice(0, 500) || "executed";
        action.executedByUserId = Number(user?.secureStayUserId ?? user?.id) || null;
        action.executedByName =
            user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
        action.executedAt = new Date();
        const saved = await this.repo.save(action);
        logger.info(`[AIProposedAction] executed ${saved.id} (${saved.actionType}): ${saved.resultNote}`);
        return saved;
    }

    async dismiss(id: number, user: any): Promise<AIProposedActionEntity> {
        const action = await this.repo.findOne({ where: { id } });
        if (!action) throw new Error(`Proposed action ${id} not found`);
        if (action.status !== "proposed") return action;
        action.status = "dismissed";
        action.executedByUserId = Number(user?.secureStayUserId ?? user?.id) || null;
        action.executedByName =
            user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
        action.executedAt = new Date();
        return this.repo.save(action);
    }
}
