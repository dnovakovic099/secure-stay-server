import { appDatabase } from "../utils/database.util";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { OverduePaymentService } from "./OverduePaymentService";
import logger from "../utils/logger.utils";

/**
 * Inbox Urgent pins beyond payment / extension_price:
 *  - access: guest can't get into the property
 *  - safety: real safety emergencies only (fire, flood, injury, police, etc.)
 *  - early_checkin / early_checkout / late_checkout: time-sensitive schedule
 *    asks within 48h of the relevant date
 *
 * Payment pins always win (OverduePaymentService.raiseEmergency will not
 * downgrade them). These types land in the dashboard Urgent section.
 */
export type UrgentPinType =
    | "access"
    | "safety"
    | "early_checkin"
    | "early_checkout"
    | "late_checkout";

// Note: match "working"/"works" as whole words — a bare `work` + trailing `\b`
// fails on "not working" (no boundary between "work" and "ing").
const ACCESS_RE =
    /\b(?:lock(?:ed)?\s*out|can'?t\s+(?:get|figure)\s+(?:in|inside|into|the\s+door)|cannot\s+(?:get\s+in|enter|access)|unable\s+to\s+(?:get\s+in|enter|access)|won'?t\s+let\s+(?:me|us)\s+in|door\s+(?:won'?t|wont|will\s+not)\s+open|(?:door\s+|gate\s+|garage\s+|access\s+|lock\s+)?code\b[^.!?\n]{0,60}\b(?:not|isn'?t|doesn'?t|won'?t|wont|stopped)\s+work(?:ing|s)?\b|(?:keypad|lock|door)\b[^.!?\n]{0,60}\b(?:not|isn'?t|doesn'?t|won'?t|wont|stopped)\s+work(?:ing|s)?\b|wrong\s+code|code\s+(?:is\s+)?(?:invalid|incorrect|wrong)|access(?:\s+code)?\s+(?:is\s+)?(?:wrong|invalid|not\s+working)|key\s+(?:doesn'?t|does\s+not|won'?t)\s+work(?:ing|s)?\b|(?:keypad|digit|code).{0,40}\b(?:red|won'?t\s+accept|doesn'?t\s+accept)|can'?t\s+(?:access|get\s+into)\s+(?:the\s+)?(?:property|unit|house|place|back\s+house|cottage)|locked\s+out|no\s+(?:access|entry))\b/i;

/**
 * Guest confirms they got in — clear access pins.
 * Avoids "I'm in transit" / mid-lockout "I'm in front of the house".
 */
const ACCESS_RESOLVED_RE =
    /\b(?:i(?:'?m|\s+am)|we(?:'?re|\s+are))\s+in(?:side)?(?:\s*[,!.]|\s+(?:now|thanks|thank\s*you|ok|okay|all\s+good)|$)|(?:thank(?:s|\s*you)|all\s+good).{0,24}\b(?:i(?:'?m|\s+am)|we(?:'?re|\s+are))\s+in(?:side)?\b|\b(?:got|made)\s+(?:it\s+)?(?:in(?:side)?|through)\b|\b(?:successfully\s+)?(?:got|gained)\s+(?:in|inside|access)\b|\b(?:code|keypad|lock|door)\s+(?:worked|works(?:\s+now)?|is\s+working(?:\s+now)?)\b|\bwe(?:'?re|\s+are)\s+(?:inside|in\s+now)\b/i;

/** Real emergencies only — not generic "urgent" / ops annoyances. */
const SAFETY_RE =
    /\b(fire|flood(?:ing)?|gas\s+leak|carbon\s+monoxide|\bco\s+alarm|smoke\s+alarm|ambulanc|police|911|bleeding|broke(?:n)?\s+(my|his|her|our)\s+(arm|leg|bone)|injur(?:y|ed)|unconscious|overdose|assault|weapon|gunshot)\b/i;

const EARLY_CHECKIN_RE =
    /\bearly[\s-]*check[\s-]*in\b|\bcheck[\s-]*in\s+(early|earlier)\b|\barrive\s+(early|earlier|before\s+check[\s-]*in)\b|\bget\s+in\s+early\b|\bdrop\s+(our|my|the)\s+(bags|luggage)\s+early\b/i;

const EARLY_CHECKOUT_RE =
    /\bearly[\s-]*check[\s-]*out\b|\bcheck[\s-]*out\s+(early|earlier|sooner)\b|\bleave\s+early\b|\bdepart\s+early\b|\bneed\s+to\s+(leave|check\s*out)\s+(early|earlier|sooner)\b/i;

const LATE_CHECKOUT_RE =
    /\b(late|extended?)[\s-]*check[\s-]*out\b|\bcheck[\s-]*out\s+(late|later|a little later|an hour later)\b|\bstay\s+(an hour|a bit|a little)\s+(longer|later)\b/i;

const TIME_SENSITIVE_HOURS = 48;

const PIN_PRIORITY: Record<string, number> = {
    payment: 100,
    safety: 90,
    access: 80,
    extension_price: 50,
    early_checkin: 40,
    early_checkout: 40,
    late_checkout: 40,
};

export class InboxUrgentPinService {
    private overdue = new OverduePaymentService();
    private conversationRepo = () => appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = () => appDatabase.getRepository(InboxMessageEntity);

    static detectsAccess(text: string): boolean {
        return ACCESS_RE.test(String(text || ""));
    }

    /** Guest says they got in / code worked — access issue is over. */
    static detectsAccessResolved(text: string): boolean {
        const body = String(text || "").trim();
        if (!body) return false;
        // Still reporting a live lockout → do not clear.
        if (InboxUrgentPinService.detectsAccess(body)) return false;
        return ACCESS_RESOLVED_RE.test(body);
    }

    static detectsSafety(text: string): boolean {
        return SAFETY_RE.test(String(text || ""));
    }

    static detectsEarlyCheckin(text: string): boolean {
        return EARLY_CHECKIN_RE.test(String(text || ""));
    }

    static detectsEarlyCheckout(text: string): boolean {
        return EARLY_CHECKOUT_RE.test(String(text || ""));
    }

    static detectsLateCheckout(text: string): boolean {
        return LATE_CHECKOUT_RE.test(String(text || ""));
    }

    private dateStr(d: any): string | null {
        if (!d) return null;
        try {
            return new Date(d).toISOString().slice(0, 10);
        } catch {
            return typeof d === "string" ? d.slice(0, 10) : null;
        }
    }

    /** True when `dateVal` (YYYY-MM-DD) is within ±windowHours of now (calendar day). */
    isWithinHoursOfDate(dateVal: any, windowHours = TIME_SENSITIVE_HOURS): boolean {
        const d = this.dateStr(dateVal);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
        const target = new Date(`${d}T12:00:00.000Z`).getTime();
        if (!Number.isFinite(target)) return false;
        const diffH = (target - Date.now()) / (3600 * 1000);
        // From `windowHours` before noon through ~end of that local-ish day.
        return diffH <= windowHours && diffH >= -18;
    }

    /**
     * Classify guest text into at most one urgent pin (highest severity).
     * Schedule asks only qualify inside the 48h window of the relevant date.
     */
    classify(
        text: string,
        conversation: Pick<InboxConversationEntity, "checkin" | "checkout">
    ): { type: UrgentPinType; reason: string } | null {
        const body = String(text || "").trim();
        if (!body) return null;

        if (InboxUrgentPinService.detectsSafety(body)) {
            return {
                type: "safety",
                reason:
                    "Guest reported a safety emergency (fire/flood/injury/police/etc.). Contact them immediately and escalate as needed.",
            };
        }
        if (InboxUrgentPinService.detectsAccess(body)) {
            return {
                type: "access",
                reason:
                    "Guest can't get into the property (lockout / code / door). Help them get access now.",
            };
        }
        if (
            InboxUrgentPinService.detectsEarlyCheckin(body) &&
            this.isWithinHoursOfDate(conversation.checkin, TIME_SENSITIVE_HOURS)
        ) {
            return {
                type: "early_checkin",
                reason: `Time-sensitive early check-in request (check-in ${this.dateStr(conversation.checkin) || "soon"} — within 48h). Confirm availability and reply.`,
            };
        }
        if (
            InboxUrgentPinService.detectsEarlyCheckout(body) &&
            this.isWithinHoursOfDate(conversation.checkout, TIME_SENSITIVE_HOURS)
        ) {
            return {
                type: "early_checkout",
                reason: `Time-sensitive early check-out request (check-out ${this.dateStr(conversation.checkout) || "soon"} — within 48h). Confirm and coordinate.`,
            };
        }
        if (
            InboxUrgentPinService.detectsLateCheckout(body) &&
            this.isWithinHoursOfDate(conversation.checkout, TIME_SENSITIVE_HOURS)
        ) {
            return {
                type: "late_checkout",
                reason: `Time-sensitive late check-out request (check-out ${this.dateStr(conversation.checkout) || "soon"} — within 48h). Confirm availability and fee if any.`,
            };
        }
        return null;
    }

    private shouldReplaceExisting(existingType: string | null | undefined, next: UrgentPinType): boolean {
        if (!existingType) return true;
        const cur = PIN_PRIORITY[String(existingType).toLowerCase()] ?? 0;
        const nxt = PIN_PRIORITY[next] ?? 0;
        return nxt >= cur;
    }

    /**
     * Raise an Urgent pin from a guest message when it matches access / safety /
     * time-sensitive schedule asks. Also clears access pins when the guest later
     * confirms they got in. No-op when payment already pinned or text doesn't
     * qualify.
     */
    async evaluateAndRaise(
        conversation: InboxConversationEntity,
        guestText: string
    ): Promise<{ raised: boolean; cleared?: boolean; type?: UrgentPinType }> {
        try {
            if (!conversation?.threadId) return { raised: false };

            const existingType =
                Number(conversation.emergency) === 1
                    ? String(conversation.emergencyType || "payment").toLowerCase()
                    : null;

            // Access issue solved ("Im in thank you") → drop the urgent pin.
            if (
                existingType === "access" &&
                InboxUrgentPinService.detectsAccessResolved(guestText)
            ) {
                const ok = await this.overdue.clearEmergency(Number(conversation.threadId));
                if (ok) {
                    logger.info(
                        `[InboxUrgentPin] Cleared access pin on thread ${conversation.threadId} (guest confirmed entry)`
                    );
                }
                return { raised: false, cleared: ok };
            }

            const hit = this.classify(guestText, conversation);
            if (!hit) return { raised: false };

            if (existingType === "payment") return { raised: false };
            if (existingType && !this.shouldReplaceExisting(existingType, hit.type)) {
                return { raised: false };
            }

            const notify = hit.type === "access" || hit.type === "safety";
            const raised = await this.overdue.raiseEmergency(conversation, hit.reason, hit.type, {
                notify,
            });
            if (raised) {
                logger.info(
                    `[InboxUrgentPin] Raised ${hit.type} on thread ${conversation.threadId}`
                );
            }
            return { raised, type: hit.type };
        } catch (err: any) {
            logger.warn(
                `[InboxUrgentPin] evaluateAndRaise failed thread=${conversation?.threadId}: ${err?.message}`
            );
            return { raised: false };
        }
    }

    /**
     * Drop schedule pins outside the 48h window, access/safety pins on past
     * stays, and access pins where the latest guest message confirms entry.
     * Called from inbox list alongside payment pin cleanup.
     */
    async clearStaleUrgentPins(): Promise<number> {
        try {
            const pinned = await this.conversationRepo()
                .createQueryBuilder("c")
                .select([
                    "c.threadId",
                    "c.checkin",
                    "c.checkout",
                    "c.emergencyType",
                    "c.reservationStatus",
                ])
                .where("c.emergency = 1")
                .andWhere("c.emergencyType IN (:...types)", {
                    types: ["access", "safety", "early_checkin", "early_checkout", "late_checkout"],
                })
                .getMany();
            if (!pinned.length) return 0;

            const today = new Date().toISOString().slice(0, 10);
            let cleared = 0;
            for (const c of pinned) {
                const type = String(c.emergencyType || "").toLowerCase();
                let drop = false;
                if (type === "early_checkin") {
                    drop = !this.isWithinHoursOfDate(c.checkin, TIME_SENSITIVE_HOURS);
                } else if (type === "early_checkout" || type === "late_checkout") {
                    drop = !this.isWithinHoursOfDate(c.checkout, TIME_SENSITIVE_HOURS);
                } else if (type === "access" || type === "safety") {
                    const checkout = this.dateStr(c.checkout);
                    drop = !!checkout && checkout < today;
                }
                // Access: guest later said "Im in thank you" — drop even mid-stay.
                if (!drop && type === "access") {
                    const msgs = await this.messageRepo().find({
                        where: { threadId: Number(c.threadId) },
                        order: { sentAt: "DESC", id: "DESC" },
                        take: 8,
                    });
                    const guest = msgs.find(
                        (m) =>
                            m.direction === "incoming" &&
                            !Number(m.isAutomatic) &&
                            String(m.body || "").trim()
                    );
                    if (guest?.body && InboxUrgentPinService.detectsAccessResolved(guest.body)) {
                        drop = true;
                    }
                }
                if (!drop) continue;
                const ok = await this.overdue.clearEmergency(Number(c.threadId));
                if (ok) cleared++;
            }
            if (cleared > 0) {
                logger.info(`[InboxUrgentPin] Cleared ${cleared} stale urgent pin(s)`);
            }
            return cleared;
        } catch (err: any) {
            logger.warn(`[InboxUrgentPin] clearStaleUrgentPins failed: ${err?.message}`);
            return 0;
        }
    }

    /**
     * Best-effort: scan recent unanswered guest messages and pin any that still
     * qualify (so open lockouts appear under Urgent without waiting for a new msg).
     */
    async scanRecentUnanswered(limit = 80): Promise<number> {
        try {
            const rows: Array<{ threadId: number }> = await appDatabase.query(
                `SELECT c.threadId
                 FROM inbox_conversations c
                 WHERE c.answered = 0
                   AND c.lastMessageAt >= (NOW() - INTERVAL 7 DAY)
                   AND (c.emergency = 0 OR c.emergency IS NULL)
                   AND COALESCE(c.reservationStatus, '') NOT IN (
                       'cancelled','canceled','inquiry','expired','declined','denied'
                   )
                 ORDER BY c.lastMessageAt DESC
                 LIMIT ?`,
                [limit]
            );
            let raised = 0;
            for (const row of rows) {
                const threadId = Number(row.threadId);
                const conversation = await this.conversationRepo().findOne({ where: { threadId } });
                if (!conversation) continue;
                const msgs = await this.messageRepo().find({
                    where: { threadId },
                    order: { sentAt: "DESC", id: "DESC" },
                    take: 12,
                });
                const guest = msgs.find(
                    (m) => m.direction === "incoming" && !Number(m.isAutomatic) && String(m.body || "").trim()
                );
                if (!guest?.body) continue;
                const result = await this.evaluateAndRaise(conversation, guest.body);
                if (result.raised) raised++;
            }
            if (raised > 0) {
                logger.info(`[InboxUrgentPin] scanRecentUnanswered raised ${raised} pin(s)`);
            }
            return raised;
        } catch (err: any) {
            logger.warn(`[InboxUrgentPin] scanRecentUnanswered failed: ${err?.message}`);
            return 0;
        }
    }
}
