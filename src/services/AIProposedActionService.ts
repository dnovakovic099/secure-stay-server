import { In, Not } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIProposedActionEntity } from "../entity/AIProposedAction";
import { AIMessageSuggestionEntity } from "../entity/AIMessageSuggestion";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { ActionItems } from "../entity/ActionItems";
import { Hostify } from "../client/Hostify";
import { AIMessagingSettingsService } from "./AIMessagingSettingsService";
import { AIMemoryService } from "./AIMemoryService";

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
// "create_ops_ticket" is fully retired: never proposed, never executed, and
// filtered out of the read paths so pre-cutover rows in ai_proposed_actions stop
// surfacing as cards. InboxItemDetectionService already opens a Guest Issues
// ticket for the same problem reports, and this type carried no proposedReply,
// so approving it only produced a duplicate work item. Rows are preserved for
// history and dismissed by migration 20260727_retire_create_ops_ticket.sql.
export const RETIRED_ACTION_TYPE = "create_ops_ticket";

export const PROPOSED_ACTION_DEFAULTS = {
    proposedActionInstructions:
        "Proposed Actions are generated after an AI suggestion is saved for an incoming guest message. The detector looks for early check-in, late checkout, and access-code/lockout requests. Operational problem reports are handled by Guest Issues tickets instead. Existing open proposals of the same action type on the thread block duplicates.",
    proposedActionApproveInstructions:
        "Approve creates the internal task/action tied to the proposal and marks the proposal executed. It does not send the proposed guest reply.",
    proposedActionApproveSendInstructions:
        "Approve & send sends the editable proposed reply to the guest, creates any tied internal task/action, cancels queued delayed auto-send for that thread, and marks the proposal executed.",
};

export interface ProposedActionInput {
    conversation: InboxConversationEntity;
    guestMessage: InboxMessageEntity | null;
    /** Optional — urgent-pin detection can propose actions before a reply draft exists. */
    suggestion: AIMessageSuggestionEntity | null;
}

/** Structured next steps shown in the inbox; Accept stays disabled until automation ships. */
export type RecommendedActionStep = {
    id: string;
    label: string;
    detail?: string;
    status: "recommended" | "optional" | "blocked";
};

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

    private settingsReference(settings: any): string | null {
        const value = String(settings?.proposedActionInstructions || "").trim();
        if (!value) return null;
        return `Settings reference: ${value.slice(0, 1000)}`;
    }

    private withSettingsReference(evidence: string, reference: string | null): string {
        return reference ? `${evidence}\n\n${reference}` : evidence;
    }

    /**
     * Detect and persist proposals for an inbound guest message. Idempotent per
     * (thread, actionType): an existing open proposal of the same type blocks a
     * duplicate. Never throws — best-effort, fire-and-forget from callers.
     */
    async detectForMessage(input: ProposedActionInput): Promise<AIProposedActionEntity[]> {
        const created: AIProposedActionEntity[] = [];
        try {
            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
            if (settings && settings.proposedActionsEnabled === 0) return created;
            const reference = this.settingsReference(settings);

            const { isInquirySupersededByAcceptedStay } = await import("./InboxInquirySuperseded");
            if (await isInquirySupersededByAcceptedStay(input.conversation)) return created;
            const { hasNoResponseNeededNote } = await import("./InboxNoResponseNeeded");
            if (await hasNoResponseNeededNote(Number(input.conversation.threadId))) return created;

            const text = String(input.guestMessage?.body || "").trim();
            if (!text) return created;

            // Cheap regex screen first — only hit the DB when something matched.
            const matchedAny =
                LATE_CHECKOUT_RE.test(text) || EARLY_CHECKIN_RE.test(text) || LOCKOUT_RE.test(text);
            if (!matchedAny) return created;

            const open = await this.repo.find({
                where: { threadId: Number(input.conversation.threadId), status: "proposed" },
            });
            const hasOpen = (type: string) => open.some((a) => a.actionType === type);

            if (LATE_CHECKOUT_RE.test(text) && !hasOpen("late_checkout")) {
                const a = await this.proposeScheduleChange(input, "late_checkout", text, reference);
                if (a) created.push(a);
            }
            if (EARLY_CHECKIN_RE.test(text) && !hasOpen("early_check_in")) {
                const a = await this.proposeScheduleChange(input, "early_check_in", text, reference);
                if (a) created.push(a);
            }
            // Access-code resend still needs a suggestion context for one-click send today.
            if (LOCKOUT_RE.test(text) && !hasOpen("resend_access_code") && input.suggestion) {
                const a = await this.proposeAccessCodeResend(input, text, reference);
                if (a) created.push(a);
            }
        } catch (err: any) {
            logger.warn(`[AIProposedAction] detection failed (thread ${input.conversation.threadId}): ${err.message}`);
        }
        return created;
    }

    /**
     * Run schedule-action detection from an urgent pin / inbound path even when
     * no AI reply draft was generated (AI paused, ack skip, etc.).
     */
    async detectForConversation(
        conversation: InboxConversationEntity,
        guestMessage: InboxMessageEntity | null,
        guestText?: string
    ): Promise<AIProposedActionEntity[]> {
        const synthetic = guestMessage
            ? guestMessage
            : ({
                  body: guestText || "",
                  direction: "incoming",
                  externalId: null,
              } as any);
        if (guestText && !guestMessage) {
            synthetic.body = guestText;
        }
        return this.detectForMessage({
            conversation,
            guestMessage: synthetic,
            suggestion: null,
        });
    }

    private async getVerifiedScheduleFact(
        listingId: number | null | undefined,
        type: "late_checkout" | "early_check_in"
    ): Promise<string | null> {
        if (!listingId) return null;
        try {
            const { PropertyFactsService } = await import("./PropertyFactsService");
            const { facts } = await new PropertyFactsService().getForListing(Number(listingId));
            const key = type === "early_check_in" ? "early_check_in" : "late_checkout";
            const row = (facts || []).find(
                (f) => f.fieldKey === key && f.status === "verified" && String(f.value || "").trim()
            );
            return row ? String(row.value).trim() : null;
        } catch {
            return null;
        }
    }

    private factImpliesCleanerCheck(fact: string | null): boolean {
        if (!fact) return false;
        return /\b(cleaner|housekeep|turnover|check with|confirm with|approval|availability|ops|team)\b/i.test(
            fact
        );
    }

    private buildScheduleRecommendedSteps(params: {
        type: "late_checkout" | "early_check_in";
        verifiedFact: string | null;
        feeBit: string | null;
        nightOpen: boolean | null;
        autoRespond: string | null;
    }): RecommendedActionStep[] {
        const label = params.type === "late_checkout" ? "late checkout" : "early check-in";
        const steps: RecommendedActionStep[] = [];

        if (params.verifiedFact) {
            steps.push({
                id: "follow_verified_fact",
                label: "Follow listing Verified Facts policy",
                detail: params.verifiedFact.slice(0, 400),
                status: "recommended",
            });
        } else {
            steps.push({
                id: "infer_policy",
                label: "No Verified Fact — use Upsells / calendar / team norms",
                detail:
                    params.autoRespond === "quote" && params.feeBit
                        ? `Upsells allows quoting ${params.feeBit} subject to availability.`
                        : params.autoRespond === "deny"
                          ? "Upsells/SDTO says auto-decline for this stay."
                          : "Confirm availability with ops before promising a clock time.",
                status: "recommended",
            });
        }

        const needsCleaner =
            this.factImpliesCleanerCheck(params.verifiedFact) ||
            params.autoRespond === "escalate" ||
            params.nightOpen !== true;
        if (needsCleaner && params.autoRespond !== "deny") {
            steps.push({
                id: "check_cleaner",
                label: "Check with cleaner / housekeeping that the unit will be ready",
                detail:
                    "Text or task the active cleaner. Wait for their yes/no before confirming a specific early time to the guest.",
                status: "recommended",
            });
        }

        if (params.feeBit && params.autoRespond !== "deny") {
            steps.push({
                id: "quote_fee",
                label: `Quote ${label} fee (${params.feeBit}) subject to availability`,
                status: "recommended",
            });
        }

        steps.push({
            id: "hold_guest",
            label: "Hold the guest with an honest commitment (no false “already arranged”)",
            detail: "Tell them you’re checking availability and will follow up — do not claim the team is already on it unless the ops ledger shows it.",
            status: "recommended",
        });

        steps.push({
            id: "close_loop",
            label: "After cleaner/ops reply → accept or deny, then text the guest",
            detail: "Future automation will update the action item from the cleaner webhook and message the guest. Accept is disabled until that ships.",
            status: "blocked",
        });

        return steps;
    }

    /**
     * Late checkout / early check-in: use Upsells (rate config + charge type +
     * SDTO) and reservation adjacency for same-day turnover. Calendar remains
     * supporting evidence. When SDTO is Not Allowed and same-day turnover
     * exists, auto-propose a decline reply (no fee).
     */
    private async proposeScheduleChange(
        input: ProposedActionInput,
        type: "late_checkout" | "early_check_in",
        guestText: string,
        settingsReference: string | null
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

        const { UpsellQuoteService } = await import("./UpsellQuoteService");
        const quoteService = new UpsellQuoteService();
        const quotes = await quoteService
            .listQuotesForListing({
                listingId: Number(conv.listingId),
                nights: conv.nights != null ? Number(conv.nights) : null,
                checkin: conv.checkin,
                checkout: conv.checkout,
                reservationId: conv.reservationId != null ? Number(conv.reservationId) : null,
            })
            .catch(() => []);
        const match = quotes.find((q) =>
            type === "early_check_in" ? q.isEarlyCheckin : q.isLateCheckout
        );

        const label = type === "late_checkout" ? "late checkout" : "early check-in";
        const guestFirst = (conv.guestName || "").split(" ")[0] || "there";
        const feeBit =
            match?.guestFee != null
                ? `$${Number(match.guestFee).toFixed(2)}${match.unitLabel ? ` (${match.unitLabel})` : ""}`
                : null;

        const calendarEvidence =
            nightOpen === true
                ? `Live calendar: the night of ${key} is OPEN.`
                : nightOpen === false
                  ? `Live calendar: the night of ${key} is NOT open.`
                  : `Live calendar unavailable for ${key}.`;

        const upsellEvidence = match
            ? [
                  `Upsells: ${match.title}`,
                  `SDTO=${match.sdtoRaw || "Allowed"} (${match.sdto})`,
                  `rate=${match.rateConfiguration || "Fixed Rate"}`,
                  `charge=${match.chargeType || "n/a"}`,
                  `fee=${feeBit || "n/a"}`,
                  `autoRespond=${match.autoRespond}`,
                  `sameDayTurnoverRelevant=${match.sameDayTurnoverRelevant}`,
              ].join("; ")
            : "Upsells: no Early/Late config found for this listing.";

        // Deterministic auto-decline when SDTO Not Allowed + same-day turnover.
        if (match?.autoRespond === "deny") {
            const proposedReply =
                type === "late_checkout"
                    ? `Hi ${guestFirst}, unfortunately we can't offer a late checkout for this stay because of a same-day turnover. Standard check-out still applies — let us know if there's anything else we can help with!`
                    : `Hi ${guestFirst}, unfortunately we can't offer an early check-in for this stay because of a same-day turnover. Standard check-in still applies — happy to help with anything else!`;
            const denySteps = this.buildScheduleRecommendedSteps({
                type,
                verifiedFact: await this.getVerifiedScheduleFact(conv.listingId, type),
                feeBit: null,
                nightOpen,
                autoRespond: "deny",
            });

            return this.repo.save(
                this.repo.create({
                    suggestionId: input.suggestion?.id ?? null,
                    source: "hostify",
                    threadId: Number(conv.threadId),
                    messageId: input.guestMessage?.externalId != null ? Number(input.guestMessage.externalId) : null,
                    reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                    listingId: conv.listingId ? Number(conv.listingId) : null,
                    actionType: type,
                    title: `Recommend decline ${label}: SDTO Not Allowed + same-day turnover`,
                    evidence: this.withSettingsReference(
                        `${upsellEvidence}\n${calendarEvidence}\nGuest said: "${guestText.slice(0, 200)}"`,
                        settingsReference
                    ),
                    proposedReply,
                    taskDescription: `${type === "late_checkout" ? "Late checkout" : "Early check-in"} declined for ${conv.guestName || "guest"} — SDTO Not Allowed with same-day turnover.`,
                    payload: JSON.stringify({
                        nightDate: key,
                        nightOpen,
                        guestQuote: guestText.slice(0, 500),
                        upsellAutoRespond: "deny",
                        upsellFee: match.guestFee,
                        sdto: match.sdto,
                        sameDayTurnoverRelevant: true,
                        recommendedSteps: denySteps,
                        executionEnabled: false,
                    }),
                    status: "proposed",
                })
            );
        }

        const verifiedFact = await this.getVerifiedScheduleFact(conv.listingId, type);
        const recommendedSteps = this.buildScheduleRecommendedSteps({
            type,
            verifiedFact,
            feeBit,
            nightOpen,
            autoRespond: match?.autoRespond || null,
        });
        const needsCleaner = recommendedSteps.some((s) => s.id === "check_cleaner");

        const evidenceParts = [
            verifiedFact
                ? `Verified Facts (${type === "early_check_in" ? "early check-in" : "late check-out"}): ${verifiedFact}`
                : `Verified Facts: none on file for ${label} — inferring from Upsells/calendar.`,
            upsellEvidence,
            calendarEvidence,
            `Guest said: "${guestText.slice(0, 200)}"`,
        ];

        let proposedReply: string;
        if (match?.autoRespond === "quote" && feeBit) {
            proposedReply =
                type === "late_checkout"
                    ? `Hi ${guestFirst}, late checkout is available for ${feeBit}, subject to availability. Want me to have the team confirm that for you?`
                    : `Hi ${guestFirst}, early check-in is available for ${feeBit}, subject to availability. Want me to have the team confirm that for you?`;
        } else if (match?.autoRespond === "escalate" || needsCleaner) {
            proposedReply =
                type === "late_checkout"
                    ? `Hi ${guestFirst}, we'd love to help with a late checkout — I'm checking with the team/housekeeping and will confirm shortly!`
                    : `Hi ${guestFirst}, we'd love to get you in early — I'm checking with housekeeping on readiness and will confirm as soon as I can!`;
        } else {
            proposedReply =
                nightOpen === true
                    ? type === "late_checkout"
                        ? `Good news ${guestFirst}, we can look at a late checkout for you. Let us confirm the details shortly!`
                        : `Good news ${guestFirst}, we can look at getting you in early. We'll confirm as soon as the place is ready!`
                    : type === "late_checkout"
                      ? `Hi ${guestFirst}, we'd love to help with a late checkout — let us check the cleaning schedule and we'll confirm shortly!`
                      : `Hi ${guestFirst}, we'd love to get you in early — let us check with housekeeping and we'll confirm as soon as we can!`;
        }

        const title =
            match?.autoRespond === "quote" && feeBit
                ? `Recommend ${label} at ${feeBit}? (${key} night ${nightOpen === false ? "NOT open" : nightOpen === true ? "open" : "unverified"})`
                : needsCleaner
                  ? `Recommend ${label}: check cleaner, then confirm with guest`
                  : nightOpen === true
                    ? `Recommend ${label}? The ${key} night is open.`
                    : `Guest asked for ${label} (${key} night ${nightOpen === false ? "NOT open" : "unverified"}).`;

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion?.id ?? null,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId: input.guestMessage?.externalId != null ? Number(input.guestMessage.externalId) : null,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: type,
                title,
                evidence: this.withSettingsReference(evidenceParts.join("\n"), settingsReference),
                proposedReply,
                taskDescription: needsCleaner
                    ? `Check with cleaner/housekeeping whether ${label} is possible for ${conv.guestName || "guest"} (${conv.listingName || "listing " + conv.listingId})${feeBit ? ` — fee ${feeBit}` : ""}. After they reply, accept/deny and text the guest.`
                    : `${type === "late_checkout" ? "Late checkout" : "Early check-in"} for ${conv.guestName || "guest"} (${conv.listingName || "listing " + conv.listingId})${feeBit ? ` — fee ${feeBit}` : ""} — update the cleaning schedule if approved.`,
                payload: JSON.stringify({
                    nightDate: key,
                    nightOpen,
                    guestQuote: guestText.slice(0, 500),
                    upsellAutoRespond: match?.autoRespond || null,
                    upsellFee: match?.guestFee ?? null,
                    sdto: match?.sdto || null,
                    sameDayTurnoverRelevant: match?.sameDayTurnoverRelevant ?? null,
                    rateConfiguration: match?.rateConfiguration || null,
                    chargeType: match?.chargeType || null,
                    verifiedFact: verifiedFact,
                    recommendedSteps,
                    // Multi-step cleaner/ops loop is recommendation-only until automation ships.
                    executionEnabled: false,
                }),
                status: "proposed",
            })
        );
    }

    /** Lockout: attach the live programmed code as evidence and offer a one-click resend. */
    private async proposeAccessCodeResend(
        input: ProposedActionInput,
        guestText: string,
        settingsReference: string | null
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
                suggestionId: input.suggestion?.id ?? null,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId: input.guestMessage?.externalId != null ? Number(input.guestMessage.externalId) : null,
                reservationId: resvId,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: "resend_access_code",
                title: "Guest may be locked out — resend the live door code?",
                evidence: this.withSettingsReference(
                    `Live code programmed on the smart lock: ${code}${where ? ` (${where})` : ""}.\nGuest said: "${guestText.slice(0, 200)}"`,
                    settingsReference
                ),
                proposedReply,
                payload: JSON.stringify({ code, device: where || null, guestQuote: guestText.slice(0, 500) }),
                status: "proposed",
            })
        );
    }

    // ------------------------------------------------------------------
    // Read / execute / dismiss
    // ------------------------------------------------------------------

    /**
     * Backfill schedule recommendations when staff open a thread that already
     * has an early/late urgent pin but no (or stale) proposed-action card.
     * Safe / idempotent — never throws to callers.
     */
    async ensureScheduleRecommendationsForThread(threadId: number): Promise<void> {
        try {
            const conv = await appDatabase
                .getRepository(InboxConversationEntity)
                .findOne({ where: { threadId: Number(threadId) } });
            if (!conv?.emergency || !conv.emergencyType) return;

            const pin = String(conv.emergencyType);
            const actionType =
                pin === "early_checkin" || pin === "early_checkout"
                    ? "early_check_in"
                    : pin === "late_checkout"
                      ? "late_checkout"
                      : null;
            if (!actionType) return;

            const open = await this.repo.find({
                where: { threadId: Number(threadId), status: "proposed", actionType },
            });

            // Refresh steps on older proposals that predate recommendedSteps.
            for (const action of open) {
                let payload: any = null;
                try {
                    payload = action.payload ? JSON.parse(action.payload) : null;
                } catch {
                    payload = null;
                }
                if (Array.isArray(payload?.recommendedSteps) && payload.recommendedSteps.length) continue;

                const verifiedFact = await this.getVerifiedScheduleFact(conv.listingId, actionType);
                const recommendedSteps = this.buildScheduleRecommendedSteps({
                    type: actionType,
                    verifiedFact,
                    feeBit:
                        payload?.upsellFee != null
                            ? `$${Number(payload.upsellFee).toFixed(2)}`
                            : null,
                    nightOpen: typeof payload?.nightOpen === "boolean" ? payload.nightOpen : null,
                    autoRespond: payload?.upsellAutoRespond || null,
                });
                action.payload = JSON.stringify({
                    ...(payload || {}),
                    verifiedFact,
                    recommendedSteps,
                    executionEnabled: false,
                });
                if (verifiedFact && action.evidence && !/Verified Facts/i.test(action.evidence)) {
                    action.evidence = `Verified Facts (${actionType === "early_check_in" ? "early check-in" : "late check-out"}): ${verifiedFact}\n${action.evidence}`;
                }
                await this.repo.save(action);
            }

            if (open.length) return;

            // No open card yet — detect from the latest matching guest message.
            const messages = await appDatabase.getRepository(InboxMessageEntity).find({
                where: { threadId: Number(threadId), direction: "incoming" as any },
                order: { createdAt: "DESC" },
                take: 12,
            });
            const re = actionType === "early_check_in" ? EARLY_CHECKIN_RE : LATE_CHECKOUT_RE;
            const hit =
                messages.find((m) => re.test(String(m.body || ""))) ||
                messages[0] ||
                null;
            const text = String(hit?.body || conv.emergencyReason || "").trim();
            if (!text) return;
            await this.detectForConversation(conv, hit, text);
        } catch (err: any) {
            logger.warn(
                `[AIProposedAction] ensureScheduleRecommendations failed thread=${threadId}: ${err?.message}`
            );
        }
    }

    async listForThread(threadId: number, opts: { includeResolved?: boolean } = {}) {
        const where: any = { threadId, actionType: Not(RETIRED_ACTION_TYPE) };
        if (!opts.includeResolved) where.status = "proposed";
        return this.repo.find({ where, order: { createdAt: "DESC" } });
    }

    async listRecent(opts: { status?: string; limit?: number } = {}) {
        const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
        const where: any = { actionType: Not(RETIRED_ACTION_TYPE) };
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
        opts: { replyOverride?: string | null; taskOverride?: string | null; sendReply?: boolean } = {}
    ): Promise<AIProposedActionEntity> {
        const action = await this.repo.findOne({ where: { id } });
        if (!action) throw new Error(`Proposed action ${id} not found`);
        if (action.status !== "proposed") throw new Error(`Action ${id} is already ${action.status}`);
        // Refuse rather than silently no-op: this type no longer has a reply or a
        // task to create, so executing it would just mark the row done.
        if (action.actionType === RETIRED_ACTION_TYPE) {
            throw new Error(
                `Action ${id} is a retired ${RETIRED_ACTION_TYPE} proposal — Guest Issues tickets cover these now. Dismiss it instead.`
            );
        }
        // Schedule multi-step flows are recommendation-only until cleaner/ops automation ships.
        if (action.actionType === "early_check_in" || action.actionType === "late_checkout") {
            let executionEnabled = false;
            try {
                const payload = action.payload ? JSON.parse(action.payload) : null;
                executionEnabled = payload?.executionEnabled === true;
            } catch {
                executionEnabled = false;
            }
            if (!executionEnabled) {
                throw new Error(
                    "This recommended action is view-only for now. Accept/execute will be enabled once cleaner/ops automation ships."
                );
            }
        }

        const results: string[] = [];

        // 1) Guest-facing reply (schedule changes + code resend).
        const reply = opts.sendReply === false ? "" : (opts.replyOverride ?? action.proposedReply ?? "").trim();
        if (reply) {
            const { InboxService } = await import("./InboxService");
            await new InboxService().sendReply(Number(action.threadId), reply, user);
            results.push("reply sent to guest");
            // The guest just got a human-approved answer — cancel any queued
            // delayed auto-send still pending on this thread's suggestions.
            await appDatabase
                .query(
                    `UPDATE ai_message_suggestions SET autosendScheduledAt = NULL
                     WHERE threadId = ? AND source = 'hostify' AND autosendScheduledAt IS NOT NULL`,
                    [Number(action.threadId)]
                )
                .catch(() => {});
        }

        // 2) Internal task — schedule changes create a turnover-schedule task so
        //    cleaning is informed.
        const taskText = (opts.taskOverride ?? action.taskDescription ?? "").trim();
        if (taskText && (action.actionType === "late_checkout" || action.actionType === "early_check_in")) {
            const actionItemsRepo = appDatabase.getRepository(ActionItems);
            const conv = await appDatabase
                .getRepository(InboxConversationEntity)
                .findOne({ where: { threadId: Number(action.threadId) } })
                .catch(() => null);
            const saved = await actionItemsRepo.save(
                actionItemsRepo.create({
                    item: taskText,
                    category: "Guest Request",
                    status: "incomplete",
                    urgency: 1,
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

        // A human approving an action IS a decision. Record it as precedent so
        // the next similar ask is answered consistently instead of from scratch.
        await new AIMemoryService()
            .recordDecision({
                topic: saved.actionType,
                decision: saved.title || saved.actionType,
                rationale: [saved.evidence, saved.resultNote].filter(Boolean).join(" | "),
                listingId: saved.listingId ?? null,
                decidedByUserId: saved.executedByUserId ?? null,
            })
            .catch(() => null);

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
