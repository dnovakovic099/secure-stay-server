import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { AIProposedActionEntity } from "../entity/AIProposedAction";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { ActionItems } from "../entity/ActionItems";
import { Listing } from "../entity/Listing";
import { QuoMessageEntity } from "../entity/QuoMessage";
import { QuoConversationEntity } from "../entity/QuoConversation";
import { OpenPhoneService } from "./OpenPhoneService";
import { QuoInboxService } from "./QuoInboxService";

export type TurnoverContact = {
    role: "cleaner" | "owner";
    name: string;
    phone: string;
    phoneDigits: string;
    source: string;
};

export type CleanerReplyDecision = "accept" | "deny" | "unclear";

type CityCleanerDefault = {
    cities: string[];
    name: string;
    phone: string;
};

/** Same portfolio cleaners IR Copilot uses for OWN/Airbnb markets. */
const PORTFOLIO_CLEANERS: CityCleanerDefault[] = [
    {
        cities: ["Chicago", "Elmwood Park", "Lombard"],
        name: "Ana",
        phone: "(773) 592-5234",
    },
    {
        cities: [
            "Tampa",
            "Bradenton",
            "St. Petersburg",
            "St Petersburg",
            "Largo",
            "Clearwater",
            "Madeira Beach",
        ],
        name: "Diana",
        phone: "(813) 830-3287",
    },
];

const STRONG_DENY_RE =
    /\b(not ready|can't|cannot|cant|won't|wont|unavailable|unable|deny|denied|too tight|not possible|negative|nope)\b/i;
const ACCEPT_RE =
    /\b(yes|yep|yeah|ok|okay|sure|fine|good|cleared|available|can do|works|approved|all set|confirmed|confirm|go ahead|you can|they can|ready)\b/i;

/**
 * ScheduleActionOpsLoopService
 *
 * Early check-in / late checkout Accept flow:
 *   1) Quo SMS turnover contact (cleaner, or owner for Launch)
 *   2) Hostify hold reply to guest
 *   3) On Quo inbound reply → classify → Hostify final guest message
 */
export class ScheduleActionOpsLoopService {
    private actionRepo = appDatabase.getRepository(AIProposedActionEntity);
    private openPhone = new OpenPhoneService();

    static normalizePhoneDigits(phone: string | null | undefined): string {
        const digits = String(phone || "").replace(/\D/g, "");
        if (digits.length >= 10) return digits.slice(-10);
        return digits;
    }

    static classifyCleanerReply(text: string): CleanerReplyDecision {
        const body = String(text || "").trim();
        if (!body) return "unclear";
        // Prefer strong deny phrases ("not ready") before bare "ready" accept matches.
        if (STRONG_DENY_RE.test(body)) return "deny";
        if (/^\s*no\b|[^\w]no\b/i.test(body) && !ACCEPT_RE.test(body)) return "deny";
        if (ACCEPT_RE.test(body)) {
            // "yes but only after 4" → staff decide
            if (/\b(but|except|only|after|before|until|if)\b/i.test(body)) return "unclear";
            return "accept";
        }
        if (/^\s*no\b/i.test(body)) return "deny";
        return "unclear";
    }

    static isQuoConfigured(): boolean {
        return Boolean(process.env.QUO_API_KEY || process.env.OPEN_PHONE_API_KEY);
    }

    private parsePayload(action: AIProposedActionEntity): Record<string, any> {
        try {
            return action.payload ? JSON.parse(action.payload) : {};
        } catch {
            return {};
        }
    }

    private async loadListing(listingId: number | null | undefined): Promise<Listing | null> {
        if (!listingId) return null;
        return appDatabase.getRepository(Listing).findOne({ where: { id: Number(listingId) } }).catch(() => null);
    }

    private isLaunchClient(tags: string | null | undefined): boolean {
        const tagTokens = String(tags || "")
            .split(/[,;|]/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean);
        return (
            tagTokens.includes("launch") ||
            tagTokens.some((t) => t === "10%" || t === "10" || /^10\s*%$/.test(t))
        );
    }

    private portfolioGroup(tags: string | null | undefined): "G1" | "G2" | null {
        const lower = String(tags || "").toLowerCase();
        if (lower.includes("group1") || /\bg1\b/.test(lower)) return "G1";
        if (lower.includes("group2") || /\bg2\b/.test(lower)) return "G2";
        return null;
    }

    private usableCity(value: any): boolean {
        const s = String(value || "").trim();
        if (!s) return false;
        if (/not\s*specified/i.test(s)) return false;
        return true;
    }

    private async resolveCity(listing: Listing | null): Promise<string | null> {
        if (!listing) return null;
        if (this.usableCity(listing.city)) return String(listing.city).trim();
        const addr = String(listing.address || "").trim();
        for (const region of PORTFOLIO_CLEANERS) {
            for (const city of region.cities) {
                if (new RegExp(`\\b${city.replace(/\s+/g, "\\s+")}\\b`, "i").test(addr)) return city;
            }
        }
        return null;
    }

    private async resolveOwnerPhone(listing: Listing): Promise<{ name: string; phone: string; source: string } | null> {
        if (listing.ownerPhone && ScheduleActionOpsLoopService.normalizePhoneDigits(listing.ownerPhone).length >= 10) {
            return {
                name: listing.ownerName || "Owner",
                phone: String(listing.ownerPhone),
                source: "listing_owner",
            };
        }
        try {
            const rows: any[] = await appDatabase.query(
                `SELECT c.firstName, c.lastName, c.preferredName, c.phone AS clientPhone
                 FROM client_properties cp
                 INNER JOIN client_management c ON c.id = cp.clientId
                 WHERE (cp.listingId = ? OR cp.hostifyListingId = ?)
                   AND cp.deletedAt IS NULL
                   AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''
                 LIMIT 1`,
                [String(listing.id), String(listing.id)]
            );
            const row = rows?.[0];
            if (row?.clientPhone && ScheduleActionOpsLoopService.normalizePhoneDigits(row.clientPhone).length >= 10) {
                const name =
                    String(row.preferredName || "").trim() ||
                    [row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
                    listing.ownerName ||
                    "Owner";
                return {
                    name,
                    phone: String(row.clientPhone),
                    source: "client_property",
                };
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    async resolveTurnoverContact(listingId: number | null | undefined): Promise<TurnoverContact | null> {
        const listing = await this.loadListing(listingId);
        if (!listing) return null;

        if (this.isLaunchClient(listing.tags)) {
            const owner = await this.resolveOwnerPhone(listing);
            if (!owner) return null;
            return {
                role: "owner",
                name: owner.name,
                phone: owner.phone,
                phoneDigits: ScheduleActionOpsLoopService.normalizePhoneDigits(owner.phone),
                source: owner.source,
            };
        }

        const city = await this.resolveCity(listing);
        if (city) {
            const key = city.toLowerCase();
            const match = PORTFOLIO_CLEANERS.find((r) =>
                r.cities.some((c) => c.toLowerCase() === key)
            );
            if (match) {
                return {
                    role: "cleaner",
                    name: match.name,
                    phone: match.phone,
                    phoneDigits: ScheduleActionOpsLoopService.normalizePhoneDigits(match.phone),
                    source: "portfolio_city",
                };
            }
        }

        // Fallback: any portfolio cleaner whose city appears in address
        const addr = `${listing.city || ""} ${listing.address || ""}`;
        for (const region of PORTFOLIO_CLEANERS) {
            if (region.cities.some((c) => new RegExp(`\\b${c.replace(/\s+/g, "\\s+")}\\b`, "i").test(addr))) {
                return {
                    role: "cleaner",
                    name: region.name,
                    phone: region.phone,
                    phoneDigits: ScheduleActionOpsLoopService.normalizePhoneDigits(region.phone),
                    source: "portfolio_address",
                };
            }
        }
        return null;
    }

    async resolveQuoSenderNumber(listingId: number | null | undefined): Promise<string | null> {
        const listing = await this.loadListing(listingId);
        const portfolio = this.portfolioGroup(listing?.tags || null);
        try {
            const quo = new QuoInboxService();
            const lines = await quo.linesForPortfolio("GR", portfolio);
            const withNumber = lines.find((l) => l.number && l.enabled);
            if (withNumber?.number) return withNumber.number;
        } catch {
            /* fall through to env */
        }

        if (portfolio === "G1") {
            return (
                process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 ||
                process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER ||
                process.env.OPEN_PHONE_SENDER_NUMBER ||
                null
            );
        }
        if (portfolio === "G2") {
            return (
                process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 ||
                process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER ||
                process.env.OPEN_PHONE_SENDER_NUMBER ||
                null
            );
        }
        return (
            process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER ||
            process.env.OPEN_PHONE_SENDER_NUMBER ||
            null
        );
    }

    /**
     * Whether Accept can run the Quo+Hostify loop (or Hostify-only deny).
     */
    async enrichExecutionReadiness(
        listingId: number | null | undefined,
        payload: Record<string, any>
    ): Promise<{
        executionEnabled: boolean;
        disableReason: string | null;
        contact: TurnoverContact | null;
        quoFromNumber: string | null;
    }> {
        if (payload?.upsellAutoRespond === "deny") {
            return {
                executionEnabled: true,
                disableReason: null,
                contact: null,
                quoFromNumber: null,
            };
        }

        if (!ScheduleActionOpsLoopService.isQuoConfigured()) {
            return {
                executionEnabled: false,
                disableReason: "Quo/OpenPhone is not configured",
                contact: null,
                quoFromNumber: null,
            };
        }

        const contact = await this.resolveTurnoverContact(listingId);
        if (!contact) {
            return {
                executionEnabled: false,
                disableReason: "No cleaner/owner phone found for this listing",
                contact: null,
                quoFromNumber: null,
            };
        }

        const quoFromNumber = await this.resolveQuoSenderNumber(listingId);
        if (!quoFromNumber) {
            return {
                executionEnabled: false,
                disableReason: "No Quo sender line configured for this portfolio",
                contact,
                quoFromNumber: null,
            };
        }

        return { executionEnabled: true, disableReason: null, contact, quoFromNumber };
    }

    private buildCleanerSms(params: {
        action: AIProposedActionEntity;
        conv: InboxConversationEntity | null;
        contact: TurnoverContact;
        guestQuote?: string | null;
    }): string {
        const label =
            params.action.actionType === "late_checkout" ? "late checkout" : "early check-in";
        const listing = params.conv?.listingName || `listing ${params.action.listingId || "?"}`;
        const guest = params.conv?.guestName || "guest";
        const checkin = params.conv?.checkin ? String(params.conv.checkin).slice(0, 10) : null;
        const checkout = params.conv?.checkout ? String(params.conv.checkout).slice(0, 10) : null;
        const when =
            params.action.actionType === "early_check_in"
                ? checkin
                    ? `check-in ${checkin}`
                    : "upcoming check-in"
                : checkout
                  ? `check-out ${checkout}`
                  : "upcoming check-out";
        const quote = params.guestQuote ? ` Guest said: "${String(params.guestQuote).slice(0, 160)}"` : "";
        return (
            `Hi ${params.contact.name.split(" ")[0] || params.contact.name} — ` +
            `can we offer ${label} for ${guest} at ${listing} (${when})? ` +
            `Please reply YES or NO.${quote}`
        ).slice(0, 900);
    }

    private buildFinalGuestReply(
        action: AIProposedActionEntity,
        conv: InboxConversationEntity | null,
        decision: "accept" | "deny"
    ): string {
        const guestFirst = (conv?.guestName || "").split(" ")[0] || "there";
        const label = action.actionType === "late_checkout" ? "late checkout" : "early check-in";
        if (decision === "accept") {
            return action.actionType === "late_checkout"
                ? `Good news ${guestFirst} — we can offer the ${label}. We'll confirm the exact time shortly. Thanks for your patience!`
                : `Good news ${guestFirst} — we can get you in early. We'll confirm the exact time shortly. Thanks for your patience!`;
        }
        return action.actionType === "late_checkout"
            ? `Hi ${guestFirst}, unfortunately we can't offer a late checkout for this stay. Standard check-out still applies — let us know if there's anything else we can help with!`
            : `Hi ${guestFirst}, unfortunately we can't offer an early check-in for this stay. Standard check-in still applies — happy to help with anything else!`;
    }

    private systemUser() {
        return { email: "schedule-ops-loop@securestay.ai", user_metadata: { full_name: "Schedule Ops" } };
    }

    /**
     * Accept path for schedule actions that need cleaner/owner confirmation.
     * Sends Quo SMS + Hostify hold; leaves status awaiting_ops.
     */
    async startAwaitingOps(
        action: AIProposedActionEntity,
        user: any,
        opts: { replyOverride?: string | null; taskOverride?: string | null; sendReply?: boolean } = {}
    ): Promise<AIProposedActionEntity> {
        const payload = this.parsePayload(action);
        if (payload.upsellAutoRespond === "deny") {
            throw new Error("Use immediate Hostify decline path for SDTO deny actions");
        }

        const readiness = await this.enrichExecutionReadiness(action.listingId, payload);
        if (!readiness.executionEnabled || !readiness.contact || !readiness.quoFromNumber) {
            throw new Error(
                readiness.disableReason ||
                    "Cannot start ops loop — missing cleaner/owner phone or Quo sender"
            );
        }

        const conv = await appDatabase
            .getRepository(InboxConversationEntity)
            .findOne({ where: { threadId: Number(action.threadId) } })
            .catch(() => null);

        const contact = readiness.contact;
        const toE164 = this.openPhone.formatPhoneNumber("+1", contact.phone) || contact.phone;
        const cleanerSms = this.buildCleanerSms({
            action,
            conv,
            contact,
            guestQuote: payload.guestQuote || null,
        });

        if (!this.openPhone.isConfigured()) {
            throw new Error("OpenPhone is not configured");
        }

        const smsResult = await this.openPhone.sendSMSWithSender(
            toE164,
            cleanerSms,
            readiness.quoFromNumber
        );
        const quoMessageId = smsResult?.data?.id || null;

        // Hostify hold to guest
        const hold =
            opts.sendReply === false
                ? ""
                : (opts.replyOverride ?? action.proposedReply ?? "").trim();
        if (hold) {
            const { InboxService } = await import("./InboxService");
            await new InboxService().sendReply(Number(action.threadId), hold, user);
            await appDatabase
                .query(
                    `UPDATE ai_message_suggestions SET autosendScheduledAt = NULL
                     WHERE threadId = ? AND source = 'hostify' AND autosendScheduledAt IS NOT NULL`,
                    [Number(action.threadId)]
                )
                .catch(() => {});
        }

        const taskText = (opts.taskOverride ?? action.taskDescription ?? "").trim();
        let taskId: number | null = payload.actionItemId || null;
        if (taskText) {
            const actionItemsRepo = appDatabase.getRepository(ActionItems);
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
            taskId = saved.id;
        }

        const steps = Array.isArray(payload.recommendedSteps) ? [...payload.recommendedSteps] : [];
        const markDone = (id: string) => {
            const idx = steps.findIndex((s: any) => s.id === id);
            if (idx >= 0) steps[idx] = { ...steps[idx], status: "recommended", detail: `${steps[idx].detail || ""} ✓ done`.trim() };
        };
        markDone("check_cleaner");
        markDone("hold_guest");

        const nextPayload = {
            ...payload,
            executionEnabled: true,
            workflowPhase: "awaiting_cleaner",
            cleanerPhone: contact.phone,
            cleanerPhoneDigits: contact.phoneDigits,
            cleanerName: contact.name,
            cleanerRole: contact.role,
            cleanerSource: contact.source,
            quoFromNumber: readiness.quoFromNumber,
            quoOutboundMessageId: quoMessageId,
            quoConversationId: payload.quoConversationId || null,
            guestHoldSentAt: hold ? new Date().toISOString() : null,
            cleanerSmsSentAt: new Date().toISOString(),
            cleanerSmsPreview: cleanerSms.slice(0, 500),
            actionItemId: taskId,
            recommendedSteps: steps.map((s: any) =>
                s.id === "close_loop"
                    ? {
                          ...s,
                          status: "recommended",
                          detail: "Waiting on cleaner/owner Quo reply — will Hostify-text the guest when they answer.",
                      }
                    : s
            ),
        };

        action.payload = JSON.stringify(nextPayload);
        action.status = "awaiting_ops";
        action.resultNote = [
            hold ? "Hostify hold sent to guest" : null,
            `Quo SMS sent to ${contact.role} ${contact.name}`,
            taskId ? `task #${taskId} created` : null,
        ]
            .filter(Boolean)
            .join("; ")
            .slice(0, 500);
        action.executedByUserId = Number(user?.secureStayUserId ?? user?.id) || null;
        action.executedByName =
            user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || null;
        // executedAt stays null until final guest outcome
        const saved = await this.actionRepo.save(action);
        logger.info(
            `[ScheduleOpsLoop] awaiting_ops action=${saved.id} contact=${contact.role}:${contact.name} phone=${contact.phoneDigits}`
        );
        return saved;
    }

    /**
     * Match an inbound Quo SMS to an awaiting schedule action and close the loop.
     */
    async onQuoInbound(input: {
        fromPhone?: string | null;
        text?: string | null;
        conversationId?: string | null;
    }): Promise<{ matched: boolean; actionId?: number; decision?: CleanerReplyDecision }> {
        try {
            const fromDigits = ScheduleActionOpsLoopService.normalizePhoneDigits(input.fromPhone);
            if (!fromDigits || fromDigits.length < 7) return { matched: false };

            const open = await this.actionRepo.find({
                where: {
                    status: In(["awaiting_ops", "needs_human"]),
                    actionType: In(["early_check_in", "late_checkout"]),
                },
                order: { updatedAt: "DESC" },
                take: 80,
            });

            let action: AIProposedActionEntity | null = null;
            for (const candidate of open) {
                const payload = this.parsePayload(candidate);
                const digits = String(
                    payload.cleanerPhoneDigits ||
                        ScheduleActionOpsLoopService.normalizePhoneDigits(payload.cleanerPhone) ||
                        ""
                );
                if (digits && digits === fromDigits) {
                    action = candidate;
                    break;
                }
                if (
                    input.conversationId &&
                    payload.quoConversationId &&
                    String(payload.quoConversationId) === String(input.conversationId)
                ) {
                    action = candidate;
                    break;
                }
            }

            if (!action) return { matched: false };

            const payload = this.parsePayload(action);
            // Persist conversation id for future matches
            if (input.conversationId && !payload.quoConversationId) {
                payload.quoConversationId = input.conversationId;
                action.payload = JSON.stringify(payload);
                await this.actionRepo.save(action);
            }

            const decision = ScheduleActionOpsLoopService.classifyCleanerReply(String(input.text || ""));
            if (decision === "unclear") {
                payload.workflowPhase = "needs_human";
                payload.lastCleanerReply = String(input.text || "").slice(0, 500);
                payload.lastCleanerReplyAt = new Date().toISOString();
                action.payload = JSON.stringify(payload);
                action.status = "needs_human";
                action.resultNote = `Cleaner/owner reply unclear — needs human. Reply: "${String(input.text || "").slice(0, 120)}"`;
                await this.actionRepo.save(action);
                logger.info(`[ScheduleOpsLoop] needs_human action=${action.id}`);
                return { matched: true, actionId: action.id, decision };
            }

            await this.finalizeDecision(action, decision, String(input.text || ""));
            return { matched: true, actionId: action.id, decision };
        } catch (err: any) {
            logger.warn(`[ScheduleOpsLoop] onQuoInbound failed: ${err?.message}`);
            return { matched: false };
        }
    }

    async finalizeDecision(
        action: AIProposedActionEntity,
        decision: "accept" | "deny",
        cleanerReply: string,
        user?: any
    ): Promise<AIProposedActionEntity> {
        const payload = this.parsePayload(action);
        const conv = await appDatabase
            .getRepository(InboxConversationEntity)
            .findOne({ where: { threadId: Number(action.threadId) } })
            .catch(() => null);

        const guestReply = this.buildFinalGuestReply(action, conv, decision);
        const { InboxService } = await import("./InboxService");
        await new InboxService().sendReply(
            Number(action.threadId),
            guestReply,
            user || this.systemUser()
        );

        if (payload.actionItemId) {
            await appDatabase
                .getRepository(ActionItems)
                .update(
                    { id: Number(payload.actionItemId) },
                    {
                        status: decision === "accept" ? "completed" : "incomplete",
                        item: `${action.taskDescription || action.title} — ${decision === "accept" ? "APPROVED" : "DENIED"} by ${payload.cleanerRole || "ops"}: "${cleanerReply.slice(0, 200)}"`,
                    } as any
                )
                .catch(() => {});
        }

        // Clear schedule urgent pin once guest has a final answer.
        try {
            const { OverduePaymentService } = await import("./OverduePaymentService");
            await new OverduePaymentService().clearEmergency(Number(action.threadId));
        } catch {
            /* non-fatal */
        }

        const steps = Array.isArray(payload.recommendedSteps) ? [...payload.recommendedSteps] : [];
        action.payload = JSON.stringify({
            ...payload,
            workflowPhase: decision === "accept" ? "accepted" : "denied",
            lastCleanerReply: cleanerReply.slice(0, 500),
            lastCleanerReplyAt: new Date().toISOString(),
            finalGuestReply: guestReply,
            finalDecision: decision,
            recommendedSteps: steps.map((s: any) =>
                s.id === "close_loop"
                    ? {
                          ...s,
                          status: "recommended",
                          detail: `Closed: ${decision}. Guest notified via Hostify.`,
                      }
                    : s
            ),
        });
        action.status = "executed";
        action.proposedReply = guestReply;
        action.resultNote = `Cleaner/owner ${decision}; Hostify final reply sent to guest`.slice(0, 500);
        action.executedAt = new Date();
        if (!action.executedByName) {
            action.executedByName = "Schedule Ops";
        }
        const saved = await this.actionRepo.save(action);
        logger.info(`[ScheduleOpsLoop] finalized action=${saved.id} decision=${decision}`);
        return saved;
    }

    /** Best-effort: load latest inbound Quo message for a conversation and try match. */
    async onQuoConversationIncoming(conversationId: string): Promise<void> {
        try {
            const conv = await appDatabase
                .getRepository(QuoConversationEntity)
                .findOne({ where: { conversationId } });
            const msg = await appDatabase.getRepository(QuoMessageEntity).findOne({
                where: { conversationId, direction: "incoming" as any },
                order: { sentAt: "DESC" },
            });
            if (!msg) return;
            await this.onQuoInbound({
                fromPhone: msg.fromNumber || conv?.participantPhone || null,
                text: msg.body,
                conversationId,
            });
        } catch (err: any) {
            logger.warn(
                `[ScheduleOpsLoop] onQuoConversationIncoming failed cid=${conversationId}: ${err?.message}`
            );
        }
    }
}
