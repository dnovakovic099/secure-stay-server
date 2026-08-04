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
/** Stay extension / extra night — not late checkout. */
const EXTENSION_RE =
    /\b(extend(?:ing|ed)?|extension|extra\s+night|another\s+night|one\s+more\s+night|1\s+more\s+night|stay\s+(?:longer|another)|add\s+(?:a\s+|another\s+)?night|additional\s+night|stay\s+an\s+extra)\b/i;
// "create_ops_ticket" is fully retired: never proposed, never executed, and
// filtered out of the read paths so pre-cutover rows in ai_proposed_actions stop
// surfacing as cards. InboxItemDetectionService already opens a Guest Issues
// ticket for the same problem reports, and this type carried no proposedReply,
// so approving it only produced a duplicate work item. Rows are preserved for
// history and dismissed by migration 20260727_retire_create_ops_ticket.sql.
export const RETIRED_ACTION_TYPE = "create_ops_ticket";

/**
 * Kill switch: proposed actions are plan/preview only. Flip true when Accept
 * should run Quo/Hostify automation again.
 */
export const BOT_ACTION_EXECUTION_ENABLED = false;

export const PROPOSED_ACTION_DEFAULTS = {
    proposedActionInstructions:
        "Proposed Actions are generated after an AI suggestion is saved for an incoming guest message. The detector looks for early check-in, late checkout, stay extensions, and access-code/lockout requests. Operational problem reports are handled by Guest Issues tickets instead. Existing open proposals of the same action type on the thread block duplicates. Accept is currently disabled — cards show the AI plan only.",
    proposedActionApproveInstructions:
        "Approve creates the internal task/action tied to the proposal and marks the proposal executed. It does not send the proposed guest reply. Currently disabled — preview only.",
    proposedActionApproveSendInstructions:
        "Approve & send sends the editable proposed reply to the guest, creates any tied internal task/action, cancels queued delayed auto-send for that thread, and marks the proposal executed. Currently disabled — preview only.",
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
                LATE_CHECKOUT_RE.test(text) ||
                EARLY_CHECKIN_RE.test(text) ||
                LOCKOUT_RE.test(text) ||
                EXTENSION_RE.test(text);
            if (!matchedAny) return created;

            const open = await this.repo.find({
                where: {
                    threadId: Number(input.conversation.threadId),
                    status: In(["proposed", "awaiting_ops", "needs_human"]),
                },
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
            // Extensions are not late checkout — separate plan (human prices the night).
            if (
                EXTENSION_RE.test(text) &&
                !LATE_CHECKOUT_RE.test(text) &&
                !hasOpen("extension")
            ) {
                const a = await this.proposeExtension(input, text, reference);
                if (a) created.push(a);
            }
            // Lockout / access — prefer live code resend; else access walkthrough plan.
            if (LOCKOUT_RE.test(text) && !hasOpen("resend_access_code") && !hasOpen("access")) {
                const codePlan = await this.proposeAccessCodeResend(input, text, reference);
                if (codePlan) created.push(codePlan);
                else {
                    const accessPlan = await this.proposeHandoverPlan(input, "access", text, reference);
                    if (accessPlan) created.push(accessPlan);
                }
            }

            // Safety emergencies (rare; also created from urgent pin ensure).
            try {
                const { InboxUrgentPinService } = await import("./InboxUrgentPinService");
                if (
                    InboxUrgentPinService.detectsSafety(text) &&
                    !hasOpen("safety")
                ) {
                    const a = await this.proposeHandoverPlan(input, "safety", text, reference);
                    if (a) created.push(a);
                }
            } catch {
                /* pin service optional for detect */
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
            detail:
                "Planned automation: Quo-text cleaner/owner, Hostify-hold the guest, auto-close from Quo webhook. Accept is disabled for now.",
            status: "blocked",
        });

        return steps;
    }

    private buildExtensionRecommendedSteps(params: {
        nightOpen: boolean | null;
        nightDate: string | null;
    }): RecommendedActionStep[] {
        return [
            {
                id: "confirm_calendar",
                label: "Confirm the night after checkout is open (dates only)",
                detail:
                    params.nightOpen === true
                        ? `Live calendar: ${params.nightDate} looks OPEN.`
                        : params.nightOpen === false
                          ? `Live calendar: ${params.nightDate} is NOT open.`
                          : "Live calendar unavailable — verify in Hostify before promising.",
                status: "recommended",
            },
            {
                id: "human_price",
                label: "Teammate prices the extension (never Hostify calendar rates)",
                detail:
                    "AI must not quote $ for extensions — calendar nightly rates have been wrong. Pull the real rate from ops/pricing.",
                status: "recommended",
            },
            {
                id: "hold_guest",
                label: "Hold the guest without quoting a dollar amount",
                detail: "Acknowledge the ask and say a teammate will confirm availability + exact price.",
                status: "recommended",
            },
            {
                id: "reply_with_price",
                label: "Hostify-reply with availability + exact extension price",
                detail: "Once priced, send the guest the exact figure and next booking steps.",
                status: "blocked",
            },
            {
                id: "update_reservation",
                label: "If accepted — update the reservation / calendar in Hostify",
                detail: "Future Accept automation will do this; preview only for now.",
                status: "blocked",
            },
        ];
    }

    private async withExecutionReadiness(
        listingId: number | null | undefined,
        payload: Record<string, any>,
        recommendedSteps: RecommendedActionStep[]
    ): Promise<Record<string, any>> {
        const { ScheduleActionOpsLoopService } = await import("./ScheduleActionOpsLoopService");
        const readiness = await new ScheduleActionOpsLoopService().enrichExecutionReadiness(
            listingId,
            payload
        );
        const steps = recommendedSteps.map((s) => {
            if (s.id !== "check_cleaner" || !readiness.contact) return s;
            return {
                ...s,
                label:
                    readiness.contact.role === "owner"
                        ? `Check with owner ${readiness.contact.name}`
                        : `Check with cleaner ${readiness.contact.name}`,
                detail: `${readiness.contact.phone} (${readiness.contact.source})`,
            };
        });
        return {
            ...payload,
            recommendedSteps: steps,
            // Always preview-only until BOT_ACTION_EXECUTION_ENABLED is flipped.
            executionEnabled: false,
            disableReason: BOT_ACTION_EXECUTION_ENABLED
                ? readiness.disableReason
                : "Bot Accept is disabled for now — view the AI plan only",
            botExecutionReady: readiness.executionEnabled,
            cleanerPhone: readiness.contact?.phone || null,
            cleanerPhoneDigits: readiness.contact?.phoneDigits || null,
            cleanerName: readiness.contact?.name || null,
            cleanerRole: readiness.contact?.role || null,
            cleanerSource: readiness.contact?.source || null,
            quoFromNumber: readiness.quoFromNumber,
            plannedChannels: {
                guest: "hostify",
                turnover: readiness.contact ? "quo" : null,
            },
        };
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
                    payload: JSON.stringify(
                        await this.withExecutionReadiness(
                            conv.listingId,
                            {
                                nightDate: key,
                                nightOpen,
                                guestQuote: guestText.slice(0, 500),
                                upsellAutoRespond: "deny",
                                upsellFee: match.guestFee,
                                sdto: match.sdto,
                                sameDayTurnoverRelevant: true,
                            },
                            denySteps
                        )
                    ),
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
                payload: JSON.stringify(
                    await this.withExecutionReadiness(
                        conv.listingId,
                        {
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
                        },
                        recommendedSteps
                    )
                ),
                status: "proposed",
            })
        );
    }

    /** Stay extension: human must price; AI plan shows calendar + hold reply only. */
    private async proposeExtension(
        input: ProposedActionInput,
        guestText: string,
        settingsReference: string | null
    ): Promise<AIProposedActionEntity | null> {
        const conv = input.conversation;
        let nightOpen: boolean | null = null;
        let nightDate: string | null = null;
        if (conv.checkout && conv.listingId && this.hostifyApiKey) {
            try {
                const key = String(conv.checkout).slice(0, 10);
                nightDate = key;
                const days = await this.hostify.getCalendar(
                    this.hostifyApiKey,
                    Number(conv.listingId),
                    key,
                    key
                );
                const day = (days || []).find((d: any) => String(d.date).slice(0, 10) === key);
                if (day) nightOpen = String(day.status || "").toLowerCase() === "available";
            } catch {
                /* evidence stays unknown */
            }
        }

        const recommendedSteps = this.buildExtensionRecommendedSteps({ nightOpen, nightDate });
        const calendarEvidence =
            nightOpen === true
                ? `Live calendar: night of ${nightDate} is OPEN (dates only — do not quote Hostify $).`
                : nightOpen === false
                  ? `Live calendar: night of ${nightDate} is NOT open.`
                  : `Live calendar unavailable${nightDate ? ` for ${nightDate}` : ""}.`;

        const proposedReply =
            "Thanks for asking about extending your stay — I'm checking availability with the team and we'll confirm the exact rate shortly.";

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion?.id ?? null,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId:
                    input.guestMessage?.externalId != null
                        ? Number(input.guestMessage.externalId)
                        : null,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType: "extension",
                title:
                    nightOpen === false
                        ? `Extension ask — night ${nightDate || "after checkout"} looks unavailable`
                        : `Extension ask — confirm availability and quote exact price`,
                evidence: this.withSettingsReference(
                    [
                        "Extension pricing security: never quote Hostify calendar nightly rates.",
                        calendarEvidence,
                        `Guest said: "${guestText.slice(0, 200)}"`,
                    ].join("\n"),
                    settingsReference
                ),
                proposedReply,
                taskDescription: `Price extension for ${conv.guestName || "guest"} (${conv.listingName || "listing"}) — confirm night after ${conv.checkout || "checkout"} and reply with exact rate (not Hostify calendar).`,
                payload: JSON.stringify({
                    nightDate,
                    nightOpen,
                    guestQuote: guestText.slice(0, 500),
                    recommendedSteps,
                    executionEnabled: false,
                    disableReason: "Bot Accept is disabled for now — view the AI plan only",
                    plannedChannels: { guest: "hostify", pricing: "human" },
                    planSummary: `1) Check calendar for ${nightDate || "night after checkout"}. 2) Human prices extension. 3) Hostify-hold guest (no $). 4) After price ready, Hostify-reply with exact rate. 5) Update reservation if accepted.`,
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
                payload: JSON.stringify({
                    code,
                    device: where || null,
                    guestQuote: guestText.slice(0, 500),
                    recommendedSteps: [
                        {
                            id: "verify_code",
                            label: "Confirm the live programmed door code on the lock",
                            detail: `Code on file: ${code}${where ? ` (${where})` : ""}`,
                            status: "recommended",
                        },
                        {
                            id: "resend_code",
                            label: "Hostify-resend the code to the guest",
                            detail: "Accept would send the proposed reply with the code. Disabled for now.",
                            status: "blocked",
                        },
                        {
                            id: "escalate_if_needed",
                            label: "If still locked out — escalate to lock vendor / on-call",
                            status: "optional",
                        },
                    ],
                    executionEnabled: false,
                    disableReason: "Bot Accept is disabled for now — view the AI plan only",
                    plannedChannels: { guest: "hostify" },
                    planSummary:
                        "1) Verify live lock code. 2) Hostify-send code to guest. 3) Escalate if still locked out.",
                }),
                status: "proposed",
            })
        );
    }

    // ------------------------------------------------------------------
    // Read / execute / dismiss
    // ------------------------------------------------------------------

    private pinToActionType(pin: string): string | null {
        const p = String(pin || "").toLowerCase();
        if (p === "early_checkin") return "early_check_in";
        if (p === "early_checkout") return "early_checkout";
        if (p === "late_checkout") return "late_checkout";
        if (p === "extension_price") return "extension";
        if (p === "payment") return "payment";
        if (p === "safety") return "safety";
        if (p === "access") return "access";
        return null;
    }

    private async latestGuestText(
        threadId: number,
        fallback?: string | null
    ): Promise<{ text: string; message: InboxMessageEntity | null }> {
        const messages = await appDatabase.getRepository(InboxMessageEntity).find({
            where: { threadId: Number(threadId), direction: "incoming" as any },
            order: { createdAt: "DESC" },
            take: 12,
        });
        const hit = messages[0] || null;
        const text = String(hit?.body || fallback || "").trim();
        return { text, message: hit };
    }

    private previewOnlyPayload(extra: Record<string, any>): Record<string, any> {
        return {
            ...extra,
            executionEnabled: false,
            disableReason: "Bot Accept is disabled for now — view the AI plan only",
        };
    }

    /**
     * Deterministic IR-style plans for payment / safety / access / AI-needs-team.
     */
    private async proposeHandoverPlan(
        input: ProposedActionInput,
        actionType:
            | "payment"
            | "safety"
            | "access"
            | "escalation"
            | "frustration"
            | "early_checkout",
        guestText: string,
        settingsReference: string | null
    ): Promise<AIProposedActionEntity | null> {
        const conv = input.conversation;
        const guestFirst = (conv.guestName || "").split(" ")[0] || "there";
        const listing = conv.listingName || (conv.listingId ? `listing ${conv.listingId}` : "the property");

        let title = "";
        let proposedReply: string | null = null;
        let taskDescription: string | null = null;
        let recommendedSteps: RecommendedActionStep[] = [];
        let planSummary = "";
        let plannedChannels: Record<string, string | null> = { guest: "hostify" };
        let evidenceParts: string[] = [];

        if (actionType === "early_checkout") {
            title = "Early checkout — confirm departure + update cleaning";
            proposedReply = `Hi ${guestFirst}, thanks for letting us know — we can note an early checkout. A teammate will confirm any schedule updates shortly.`;
            taskDescription = `Early checkout for ${conv.guestName || "guest"} at ${listing}: confirm departure time, update cleaner/turnover if needed, Hostify-confirm.`;
            recommendedSteps = [
                {
                    id: "confirm_time",
                    label: "Confirm the guest’s intended early departure date/time",
                    status: "recommended",
                },
                {
                    id: "update_cleaner",
                    label: "Update cleaner / turnover schedule if the unit frees up early",
                    detail: "Quo-text cleaner only when Accept is enabled; for now staff notifies ops.",
                    status: "recommended",
                },
                {
                    id: "no_refund_assume",
                    label: "Do not promise refunds for unused nights unless finance approves",
                    status: "recommended",
                },
                {
                    id: "hostify_confirm",
                    label: "Hostify-confirm the early departure plan to the guest",
                    status: "blocked",
                },
            ];
            planSummary =
                "1) Confirm early departure time. 2) Update cleaner/turnover. 3) No unapproved refunds. 4) Hostify confirm.";
            evidenceParts = [
                `Urgent early-checkout pin: ${conv.emergencyReason || "early checkout"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
            plannedChannels = { guest: "hostify", turnover: "quo" };
        } else if (actionType === "payment") {
            title = "Payment overdue — collect balance / confirm paid";
            proposedReply = `Hi ${guestFirst}, it looks like there may still be a balance due for your stay. Could you confirm payment when you have a moment? If you've already paid, reply here and we'll double-check on our side.`;
            taskDescription = `Verify amount due for ${conv.guestName || "guest"} (${listing}) and send payment instructions or clear the pin if already paid.`;
            recommendedSteps = [
                {
                    id: "verify_balance",
                    label: "Verify live amount due on the reservation (Hostify / payout fields)",
                    detail: "Do not invent a balance — confirm from reservation financials before asking the guest.",
                    status: "recommended",
                },
                {
                    id: "check_already_paid",
                    label: "Check whether payment already posted (platform or offline)",
                    detail: "If paid, clear the urgent pin and thank the guest — do not keep chasing.",
                    status: "recommended",
                },
                {
                    id: "hold_or_instruct",
                    label: "Hostify-reply with accurate balance / payment path (no fake links)",
                    detail: "Use known Airbnb/platform pay path or finance-approved instructions only.",
                    status: "recommended",
                },
                {
                    id: "clear_pin",
                    label: "After paid — clear Urgent payment pin and confirm with guest",
                    status: "blocked",
                },
            ];
            planSummary =
                "1) Verify real balance. 2) Check already paid. 3) Hostify-ask/instruct accurately. 4) Clear pin when settled.";
            evidenceParts = [
                `Urgent payment pin: ${conv.emergencyReason || "balance due"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
            plannedChannels = { guest: "hostify", finance: "human" };
        } else if (actionType === "safety") {
            title = "Safety emergency — human priority response";
            proposedReply = `Hi ${guestFirst}, thank you for telling us — your safety comes first. A teammate is on this now and will follow up immediately. If anyone is in danger, please call local emergency services (911) right away.`;
            taskDescription = `SAFETY: Respond immediately for ${conv.guestName || "guest"} at ${listing}. Assess risk, dispatch on-call/vendor if needed, do not leave on AI auto-send.`;
            recommendedSteps = [
                {
                    id: "human_first",
                    label: "Human takes the thread immediately (AI auto-send stays paused)",
                    detail: "Do not send casual/celebration drafts. Safety pins block autosend for a reason.",
                    status: "recommended",
                },
                {
                    id: "life_safety",
                    label: "If life/fire/gas risk — tell guest to call 911 / leave if unsafe",
                    status: "recommended",
                },
                {
                    id: "dispatch",
                    label: "Dispatch on-call / appropriate vendor (lock, plumber, electrician, etc.)",
                    detail: "Use listing contacts / IR vendor memory — do not invent phone numbers.",
                    status: "recommended",
                },
                {
                    id: "guest_update",
                    label: "Hostify-update guest with real next step (no false “already on it”)",
                    status: "blocked",
                },
                {
                    id: "close_pin",
                    label: "Resolve Guest Issue + clear Urgent pin when safe",
                    status: "blocked",
                },
            ];
            planSummary =
                "1) Human owns thread. 2) Life-safety guidance if needed. 3) Dispatch real help. 4) Honest Hostify update. 5) Clear pin when safe.";
            evidenceParts = [
                `Urgent safety pin: ${conv.emergencyReason || "safety"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
            plannedChannels = { guest: "hostify", ops: "human", vendor: "quo_or_phone" };
        } else if (actionType === "access") {
            title = "Access / lockout — get guest inside";
            proposedReply = `Hi ${guestFirst}, sorry you're having trouble getting in — I'm checking the access details for ${listing} and will help you get inside as quickly as possible.`;
            taskDescription = `Access issue for ${conv.guestName || "guest"} at ${listing}: walk entry steps from listing KB, resend code if programmed, escalate lock vendor only if still locked out.`;
            recommendedSteps = [
                {
                    id: "kb_steps",
                    label: "Walk guest through listing door-code / entry SOP (Verified Facts + KB)",
                    detail: "Never invent codes. Prefer verified access facts and prior TEAM messages.",
                    status: "recommended",
                },
                {
                    id: "live_code",
                    label: "If a live smart-lock code exists — Hostify-resend it",
                    detail: "Only send a code that is programmed on the lock for this reservation.",
                    status: "recommended",
                },
                {
                    id: "escalate_lock",
                    label: "If still locked out — contact lock vendor / on-call (not random cleaner)",
                    status: "recommended",
                },
                {
                    id: "hold_honest",
                    label: "Hostify hold: honest “checking access details” — no false ops claims",
                    status: "recommended",
                },
                {
                    id: "confirm_in",
                    label: "When guest confirms entry — clear Urgent access pin",
                    status: "blocked",
                },
            ];
            planSummary =
                "1) Listing entry SOP. 2) Resend live code only if programmed. 3) Escalate lock help if needed. 4) Honest Hostify hold. 5) Clear pin when inside.";
            evidenceParts = [
                `Urgent access pin: ${conv.emergencyReason || "access"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
            plannedChannels = { guest: "hostify", vendor: "quo_or_phone" };
        } else if (actionType === "frustration") {
            title = "Guest frustrated — human tone takeover";
            proposedReply = `Hi ${guestFirst}, I'm sorry this has been frustrating — a teammate is reviewing everything now and will make sure we take care of you.`;
            taskDescription = `Frustrated guest ${conv.guestName || ""} on ${listing}: human owns tone, resolve root issue, follow up.`;
            recommendedSteps = [
                {
                    id: "empathy",
                    label: "Human-owned empathetic Hostify reply (no defensive AI tone)",
                    status: "recommended",
                },
                {
                    id: "root_cause",
                    label: "Identify and resolve the underlying ask / issue",
                    detail: String(conv.aiNeedsHumanReason || "See AI Needs Team reason").slice(0, 300),
                    status: "recommended",
                },
                {
                    id: "gesture_if_needed",
                    label: "Consider rescue gesture only if policy allows (do not invent comps)",
                    status: "optional",
                },
                {
                    id: "clear_pin",
                    label: "Clear AI Needs Team pin after guest is cared for",
                    status: "blocked",
                },
            ];
            planSummary =
                "1) Empathetic human reply. 2) Fix root cause. 3) Optional approved gesture. 4) Clear Needs Team pin.";
            evidenceParts = [
                `AI Needs Team (frustration): ${conv.aiNeedsHumanReason || "guest frustrated"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
        } else {
            // escalation — generic missing-fact / AI deferred
            title = "AI handed off — teammate must resolve";
            proposedReply = `Hi ${guestFirst}, thanks for your patience — I'm looping in a teammate to confirm the exact details and we'll follow up shortly.`;
            taskDescription = `AI escalation for ${conv.guestName || "guest"} (${listing}): ${conv.aiNeedsHumanReason || "confirm missing fact / decision"}.`;
            recommendedSteps = [
                {
                    id: "read_reason",
                    label: "Read why AI escalated (missing fact, policy, pricing, etc.)",
                    detail: String(conv.aiNeedsHumanReason || guestText || "").slice(0, 400) || undefined,
                    status: "recommended",
                },
                {
                    id: "check_sources",
                    label: "Check Verified Facts → listing KB → Upsells → TEAM thread messages",
                    detail: "Do not guess. If still unknown, ask the right internal owner.",
                    status: "recommended",
                },
                {
                    id: "decide",
                    label: "Human decides the answer / next ops step",
                    status: "recommended",
                },
                {
                    id: "reply_guest",
                    label: "Hostify-reply with the verified answer",
                    status: "blocked",
                },
                {
                    id: "teach_bot",
                    label: "If this is a durable fact — verify into Verified Facts / teach the bot",
                    status: "optional",
                },
            ];
            planSummary =
                "1) Read escalation reason. 2) Check Facts/KB/Upsells/TEAM. 3) Human decides. 4) Hostify reply. 5) Optionally teach bot.";
            evidenceParts = [
                `AI Needs Team (escalation): ${conv.aiNeedsHumanReason || "AI deferred"}`,
                `Guest said: "${guestText.slice(0, 200)}"`,
            ];
        }

        return this.repo.save(
            this.repo.create({
                suggestionId: input.suggestion?.id ?? null,
                source: "hostify",
                threadId: Number(conv.threadId),
                messageId:
                    input.guestMessage?.externalId != null
                        ? Number(input.guestMessage.externalId)
                        : null,
                reservationId: conv.reservationId ? Number(conv.reservationId) : null,
                listingId: conv.listingId ? Number(conv.listingId) : null,
                actionType,
                title,
                evidence: this.withSettingsReference(evidenceParts.join("\n"), settingsReference),
                proposedReply,
                taskDescription,
                payload: JSON.stringify(
                    this.previewOnlyPayload({
                        guestQuote: guestText.slice(0, 500),
                        recommendedSteps,
                        planSummary,
                        plannedChannels,
                        handoverKind: actionType,
                    })
                ),
                status: "proposed",
            })
        );
    }

    /**
     * Ensure an open AI plan exists for this thread's urgent pin and/or AI Needs Team
     * flag. Idempotent. Used on thread open, pin raise, and backfill.
     */
    async ensureHandoverPlansForThread(threadId: number): Promise<AIProposedActionEntity[]> {
        const created: AIProposedActionEntity[] = [];
        try {
            const conv = await appDatabase
                .getRepository(InboxConversationEntity)
                .findOne({ where: { threadId: Number(threadId) } });
            if (!conv) return created;

            const settings = await new AIMessagingSettingsService().getGlobalCached().catch(() => null);
            if (settings && settings.proposedActionsEnabled === 0) return created;
            const reference = this.settingsReference(settings);

            const open = await this.repo.find({
                where: {
                    threadId: Number(threadId),
                    status: In(["proposed", "awaiting_ops", "needs_human"]),
                },
            });
            const hasOpen = (type: string) => open.some((a) => a.actionType === type);

            const { text, message } = await this.latestGuestText(
                threadId,
                conv.emergencyReason || conv.aiNeedsHumanReason
            );
            const input: ProposedActionInput = {
                conversation: conv,
                guestMessage: message,
                suggestion: null,
            };

            // --- Urgent pin plans ---
            if (Number(conv.emergency) === 1 && conv.emergencyType) {
                const actionType = this.pinToActionType(String(conv.emergencyType));
                if (actionType && !hasOpen(actionType)) {
                    // Prefer specialized detectors for schedule / extension / code.
                    if (
                        actionType === "early_check_in" ||
                        actionType === "late_checkout" ||
                        actionType === "extension"
                    ) {
                        const detected = await this.detectForConversation(conv, message, text);
                        created.push(...detected);
                    } else if (actionType === "early_checkout") {
                        const a = await this.proposeHandoverPlan(
                            input,
                            "early_checkout",
                            text || "early checkout",
                            reference
                        );
                        if (a) created.push(a);
                    } else if (actionType === "access") {
                        const codePlan = await this.proposeAccessCodeResend(input, text || "access", reference);
                        if (codePlan) created.push(codePlan);
                        else {
                            const a = await this.proposeHandoverPlan(
                                input,
                                "access",
                                text || "access issue",
                                reference
                            );
                            if (a) created.push(a);
                        }
                    } else if (
                        actionType === "payment" ||
                        actionType === "safety"
                    ) {
                        const a = await this.proposeHandoverPlan(
                            input,
                            actionType,
                            text || String(conv.emergencyReason || actionType),
                            reference
                        );
                        if (a) created.push(a);
                    }
                } else if (actionType && hasOpen(actionType)) {
                    // Refresh stale payloads missing steps / disableReason.
                    const existing = open.find((a) => a.actionType === actionType);
                    if (existing && existing.status === "proposed") {
                        let payload: any = {};
                        try {
                            payload = existing.payload ? JSON.parse(existing.payload) : {};
                        } catch {
                            payload = {};
                        }
                        if (!Array.isArray(payload.recommendedSteps) || !payload.recommendedSteps.length) {
                            // Force recreate steps via specialized path when possible.
                            if (actionType === "early_check_in" || actionType === "late_checkout") {
                                const verifiedFact = await this.getVerifiedScheduleFact(
                                    conv.listingId,
                                    actionType
                                );
                                const steps = this.buildScheduleRecommendedSteps({
                                    type: actionType,
                                    verifiedFact,
                                    feeBit:
                                        payload?.upsellFee != null
                                            ? `$${Number(payload.upsellFee).toFixed(2)}`
                                            : null,
                                    nightOpen:
                                        typeof payload?.nightOpen === "boolean" ? payload.nightOpen : null,
                                    autoRespond: payload?.upsellAutoRespond || null,
                                });
                                existing.payload = JSON.stringify(
                                    await this.withExecutionReadiness(
                                        conv.listingId,
                                        { ...payload, verifiedFact },
                                        steps
                                    )
                                );
                                await this.repo.save(existing);
                            }
                        } else if (payload.executionEnabled === true || !payload.disableReason) {
                            existing.payload = JSON.stringify(
                                this.previewOnlyPayload({
                                    ...payload,
                                    executionEnabled: false,
                                })
                            );
                            await this.repo.save(existing);
                        }
                    }
                }
            }

            // --- AI Needs Team plans ---
            if (Number(conv.aiNeedsHuman) === 1) {
                const kind =
                    conv.aiNeedsHumanKind === "frustration" ? "frustration" : "escalation";
                const openNow = await this.repo.find({
                    where: {
                        threadId: Number(threadId),
                        status: In(["proposed", "awaiting_ops", "needs_human"]),
                    },
                });
                const has = (type: string) => openNow.some((a) => a.actionType === type);
                if (!has(kind) && !has("escalation") && !has("frustration")) {
                    const reason = String(conv.aiNeedsHumanReason || text || "");
                    const coveredBySpecialty =
                        (EXTENSION_RE.test(reason) && has("extension")) ||
                        (EARLY_CHECKIN_RE.test(reason) && has("early_check_in")) ||
                        (LATE_CHECKOUT_RE.test(reason) && has("late_checkout")) ||
                        (LOCKOUT_RE.test(reason) && (has("access") || has("resend_access_code"))) ||
                        (/payment|balance|amount due|unpaid/i.test(reason) && has("payment")) ||
                        (/safety|fire|flood|911/i.test(reason) && has("safety"));
                    if (!coveredBySpecialty) {
                        const a = await this.proposeHandoverPlan(
                            input,
                            kind,
                            text || reason || kind,
                            reference
                        );
                        if (a) created.push(a);
                    }
                }
            }
        } catch (err: any) {
            logger.warn(
                `[AIProposedAction] ensureHandoverPlans failed thread=${threadId}: ${err?.message}`
            );
        }
        return created;
    }

    /** @deprecated alias — thread open / list actions still call this name. */
    async ensureScheduleRecommendationsForThread(threadId: number): Promise<void> {
        await this.ensureHandoverPlansForThread(threadId);
    }

    /**
     * Backfill open urgent + AI Needs Team threads. Returns counts for scripts.
     */
    async backfillHandoverPlans(opts: {
        limit?: number;
        threadIds?: number[];
        dryRun?: boolean;
    } = {}): Promise<{
        scanned: number;
        created: number;
        samples: Array<{ threadId: number; actionType: string; title: string }>;
    }> {
        const limit = Math.min(Math.max(opts.limit || 200, 1), 2000);
        let rows: InboxConversationEntity[] = [];
        if (opts.threadIds?.length) {
            rows = await appDatabase.getRepository(InboxConversationEntity).find({
                where: { threadId: In(opts.threadIds.map(Number)) as any },
            });
        } else {
            rows = await appDatabase
                .getRepository(InboxConversationEntity)
                .createQueryBuilder("c")
                .where("(c.emergency = 1 OR c.aiNeedsHuman = 1)")
                .andWhere("c.isArchived = 0")
                .orderBy("c.lastMessageAt", "DESC")
                .take(limit)
                .getMany();
        }

        let created = 0;
        const samples: Array<{ threadId: number; actionType: string; title: string }> = [];
        for (const conv of rows) {
            if (opts.dryRun) {
                const open = await this.repo.count({
                    where: {
                        threadId: Number(conv.threadId),
                        status: In(["proposed", "awaiting_ops", "needs_human"]),
                    },
                });
                samples.push({
                    threadId: Number(conv.threadId),
                    actionType: String(conv.emergencyType || conv.aiNeedsHumanKind || "none"),
                    title: open
                        ? `dry-run: already has ${open} open plan(s)`
                        : `dry-run: would create plan (pin=${conv.emergencyType || "-"} needs=${conv.aiNeedsHumanKind || "-"})`,
                });
                continue;
            }
            const before = await this.repo.count({
                where: {
                    threadId: Number(conv.threadId),
                    status: In(["proposed", "awaiting_ops", "needs_human"]),
                },
            });
            const made = await this.ensureHandoverPlansForThread(Number(conv.threadId));
            const after = await this.repo.count({
                where: {
                    threadId: Number(conv.threadId),
                    status: In(["proposed", "awaiting_ops", "needs_human"]),
                },
            });
            const n = Math.max(made.length, after - before);
            created += n;
            for (const a of made.slice(0, 2)) {
                samples.push({
                    threadId: Number(conv.threadId),
                    actionType: a.actionType,
                    title: a.title,
                });
            }
            if (!made.length && after > before) {
                samples.push({
                    threadId: Number(conv.threadId),
                    actionType: String(conv.emergencyType || conv.aiNeedsHumanKind || "?"),
                    title: `ensured (+${after - before})`,
                });
            }
        }
        return { scanned: rows.length, created, samples: samples.slice(0, 40) };
    }

    async listForThread(threadId: number, opts: { includeResolved?: boolean } = {}) {
        const where: any = { threadId, actionType: Not(RETIRED_ACTION_TYPE) };
        if (!opts.includeResolved) {
            where.status = In(["proposed", "awaiting_ops", "needs_human"]);
        }
        return this.repo.find({ where, order: { createdAt: "DESC" } });
    }

    async listRecent(opts: { status?: string; limit?: number } = {}) {
        const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
        const where: any = { actionType: Not(RETIRED_ACTION_TYPE) };
        if (opts.status) where.status = opts.status;
        else where.status = In(["proposed", "awaiting_ops", "needs_human", "executed", "dismissed"]);
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

        if (!BOT_ACTION_EXECUTION_ENABLED) {
            throw new Error("Bot Accept is disabled for now — view the AI plan only.");
        }

        // Schedule flows: Quo cleaner/owner SMS + Hostify hold, then webhook close-loop.
        // SDTO deny is Hostify-only immediate decline.
        if (action.actionType === "early_check_in" || action.actionType === "late_checkout") {
            let payload: any = {};
            try {
                payload = action.payload ? JSON.parse(action.payload) : {};
            } catch {
                payload = {};
            }

            if (payload.upsellAutoRespond === "deny") {
                // Immediate Hostify decline — no cleaner loop.
            } else {
                const { ScheduleActionOpsLoopService } = await import("./ScheduleActionOpsLoopService");
                const loop = new ScheduleActionOpsLoopService();
                const readiness = await loop.enrichExecutionReadiness(action.listingId, payload);
                if (!readiness.executionEnabled) {
                    throw new Error(
                        readiness.disableReason ||
                            "Cannot Accept yet — missing cleaner/owner phone or Quo configuration."
                    );
                }
                const saved = await loop.startAwaitingOps(action, user, opts);
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
        }

        const results: string[] = [];

        // 1) Guest-facing reply (schedule deny + door-code resend).
        const reply = opts.sendReply === false ? "" : (opts.replyOverride ?? action.proposedReply ?? "").trim();
        if (reply) {
            const { InboxService } = await import("./InboxService");
            await new InboxService().sendReply(Number(action.threadId), reply, user);
            results.push("reply sent to guest");
            await appDatabase
                .query(
                    `UPDATE ai_message_suggestions SET autosendScheduledAt = NULL
                     WHERE threadId = ? AND source = 'hostify' AND autosendScheduledAt IS NOT NULL`,
                    [Number(action.threadId)]
                )
                .catch(() => {});
        }

        // 2) Internal task — schedule deny / other schedule execute paths.
        const taskText = (opts.taskOverride ?? action.taskDescription ?? "").trim();
        if (taskText && (action.actionType === "late_checkout" || action.actionType === "early_check_in")) {
            const actionItemsRepo = appDatabase.getRepository(ActionItems);
            const conv = await appDatabase
                .getRepository(InboxConversationEntity)
                .findOne({ where: { threadId: Number(action.threadId) } })
                .catch(() => null);
            const savedTask = await actionItemsRepo.save(
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
            results.push(`task #${savedTask.id} created`);

            // Clear urgent pin after immediate decline.
            try {
                const { OverduePaymentService } = await import("./OverduePaymentService");
                await new OverduePaymentService().clearEmergency(Number(action.threadId));
            } catch {
                /* non-fatal */
            }
        }

        action.status = "executed";
        action.resultNote = results.join("; ").slice(0, 500) || "executed";
        action.executedByUserId = Number(user?.secureStayUserId ?? user?.id) || null;
        action.executedByName =
            user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
        action.executedAt = new Date();
        const saved = await this.repo.save(action);
        logger.info(`[AIProposedAction] executed ${saved.id} (${saved.actionType}): ${saved.resultNote}`);

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
        if (!["proposed", "awaiting_ops", "needs_human"].includes(action.status)) return action;
        action.status = "dismissed";
        action.executedByUserId = Number(user?.secureStayUserId ?? user?.id) || null;
        action.executedByName =
            user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
        action.executedAt = new Date();
        return this.repo.save(action);
    }
}
