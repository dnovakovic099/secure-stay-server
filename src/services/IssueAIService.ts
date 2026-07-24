import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Issue } from "../entity/Issue";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { Contact } from "../entity/Contact";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { IssueAISuggestionEntity } from "../entity/IssueAISuggestion";
import { IssueAIFeedbackEntity } from "../entity/IssueAIFeedback";
import { IrVendorMemoryEntity } from "../entity/IrVendorMemory";

const PROMPT_VERSION = "ir-copilot-v7";
const MODEL = "gpt-4o-mini";

/** NANP NPAs that show up as junk in ticket text (never store as vendor phones). */
const BOGUS_PHONE_NPAS = new Set([
    "000",
    "111",
    "222",
    "333",
    "444",
    "555",
    "666",
    "777",
    "778",
    "779",
    "888",
    "999",
]);

/** Market NPAs used to catch clear CHI↔TPA cross-market recommendations. */
const CHI_MARKET_NPAS = new Set(["312", "773", "872", "708", "847", "630", "815", "464"]);
const TPA_MARKET_NPAS = new Set(["813", "727", "941", "352", "863", "239"]);

/** Guest Relations categories — quote/policy/guest comms, not vendor dispatch. */
const GR_CATEGORIES = new Set([
    "RESERVATION CHANGES",
    "PROPERTY ACCESS",
    "PAYMENTS",
    "REFUNDS",
    "SAFETY",
    "COMMUNICATION AND ESCALATION",
    "LISTING",
    "LOST AND FOUND",
]);

/** Issue Resolution categories — vendor/cleaner dispatch lane. */
const IR_CATEGORIES = new Set([
    "MAINTENANCE",
    "HVAC",
    "CLEANLINESS",
    "SUPPLIES",
    "POOL AND SPA",
    "PEST CONTROL",
    "LANDSCAPING",
]);

type CityRegion = {
    id: string;
    cities: string[];
    defaults: Array<{
        vendorName: string;
        phone: string;
        category: string;
        role: string;
        notes: string;
    }>;
};

/** Portfolio defaults for OWN/Airbnb markets (seeded into ir_vendor_memory). */
const CITY_REGIONS: CityRegion[] = [
    {
        id: "chicago",
        cities: ["Chicago", "Elmwood Park", "Lombard"],
        defaults: [
            {
                vendorName: "Ana",
                phone: "(773) 592-5234",
                category: "CLEANLINESS",
                role: "Cleaner",
                notes: "Chicago-area portfolio cleaner (OWN/Airbnb)",
            },
            {
                vendorName: "Miguel",
                phone: "(773) 243-9091",
                category: "MAINTENANCE",
                role: "Maintenance",
                notes: "Chicago-area portfolio handyman/maintenance (OWN/Airbnb)",
            },
        ],
    },
    {
        id: "tampa",
        cities: [
            "Tampa",
            "Bradenton",
            "St. Petersburg",
            "St Petersburg",
            "Largo",
            "Clearwater",
            "Madeira Beach",
        ],
        defaults: [
            {
                vendorName: "Diana",
                phone: "(813) 830-3287",
                category: "CLEANLINESS",
                role: "Cleaner",
                notes: "Tampa-area portfolio cleaner (Diana's market)",
            },
            {
                vendorName: "Rodolfo",
                phone: "(813) 947-4704",
                category: "MAINTENANCE",
                role: "Maintenance",
                notes: "Tampa-area portfolio handyman/maintenance",
            },
        ],
    },
];

type IrUpsellGuidance = {
    title: string;
    guestFee: number | null;
    sdto: string;
    autoRespond: string;
    sameDayTurnoverRelevant: boolean;
    isEarlyCheckin: boolean;
    isLateCheckout: boolean;
    breakdown: string[];
    internalNotes: string | null;
};

type IrSpecialRulesGuidance = {
    earlyCheckinHandling: string;
    lateCheckoutHandling: string;
    opsOverrides: Array<{ field: string; value: string | null; status: string; note: string | null }>;
    listingKnowledge: string[];
    summaryLines: string[];
    /** From listing_info.tags — e.g. "10%,Launch,pm". */
    listingTags: string | null;
    /** Launch / 10% launch clients: verify early/late with owner, not cleaner. */
    isLaunchClient: boolean;
    /** Who to contact for turnover verification after special rules + Upsells. */
    turnoverContactRole: "owner" | "cleaner";
};

type IrTicketLane = {
    lane: "GR" | "IR" | "unknown";
    isReservationChange: boolean;
    isEarlyCheckinAsk: boolean;
    isLateCheckoutAsk: boolean;
    isRefundOrCancel: boolean;
    isSupplies: boolean;
    isAccessIssue: boolean;
    /** True for trade/vendor IR tickets — false for GR, supplies→cleaner, refunds. */
    needsVendorDispatch: boolean;
};

export type IrPlaybookStep = {
    step: string;
    ownerLane: "IR" | "GR" | "vendor" | "owner" | "guest" | "ops";
    detail?: string;
};

export type IrRecommendedContact = {
    rank: number;
    role: string;
    name: string;
    phone: string | null;
    email: string | null;
    reason: string;
    contactId: number | null;
    source: "guest" | "owner" | "contact" | "assignee" | "poc" | "memory";
    deepLinks?: { call?: string | null; sms?: string | null; mailto?: string | null };
};

export type IrSimilarIssue = {
    id: number;
    title: string;
    resolution: string | null;
    poc: string | null;
    category: string | null;
};

export type IrPortfolioVendor = {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    category: string | null;
    city: string | null;
    role: string | null;
    useCount: number;
    reason: string;
};

export type IrClarifyingQuestion = {
    id: string;
    question: string;
    kind: "vendor_missing" | "vendor_confirm" | "general";
};

export type IrSuggestionPayload = {
    id: number;
    issueId: number;
    summary: string | null;
    severity: string | null;
    primaryAction: string | null;
    playbook: IrPlaybookStep[];
    recommendedContacts: IrRecommendedContact[];
    draftGuestMessage: string | null;
    draftInternalNote: string | null;
    draftVendorMessage: string | null;
    warnings: string[];
    confidence: number | null;
    modelName: string | null;
    promptVersion: string | null;
    status: string;
    generatedAt: string;
    aiShortTitle?: string | null;
    aiChecklist?: string[];
    similarIssues?: IrSimilarIssue[];
    portfolioVendors?: IrPortfolioVendor[];
    clarifyingQuestions?: IrClarifyingQuestion[];
    channels?: {
        hasInboxThread: boolean;
        inboxThreadId: number | null;
        hasQuoThread: boolean;
        quoConversationId: string | null;
    };
};

export class IssueAIService {
    private issueRepo = appDatabase.getRepository(Issue);
    private updatesRepo = appDatabase.getRepository(IssueUpdates);
    private contactRepo = appDatabase.getRepository(Contact);
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private conversationRepo = appDatabase.getRepository(InboxConversationEntity);
    private messageRepo = appDatabase.getRepository(InboxMessageEntity);
    private suggestionRepo = appDatabase.getRepository(IssueAISuggestionEntity);
    private feedbackRepo = appDatabase.getRepository(IssueAIFeedbackEntity);
    private vendorMemoryRepo = appDatabase.getRepository(IrVendorMemoryEntity);
    private openai: OpenAI | null = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

    async getLatestSuggestion(issueId: number): Promise<IrSuggestionPayload | null> {
        const row = await this.suggestionRepo.findOne({
            where: { issueId },
            order: { generatedAt: "DESC", id: "DESC" },
        });
        if (!row) return null;
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        return await this.toPayload(row, issue);
    }

    async suggest(issueId: number, opts: { force?: boolean } = {}): Promise<IrSuggestionPayload> {
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);

        if (!opts.force) {
            const existing = await this.suggestionRepo.findOne({
                where: { issueId, status: In(["suggested", "accepted", "edited"]) },
                order: { generatedAt: "DESC", id: "DESC" },
            });
            if (existing && Date.now() - new Date(existing.generatedAt).getTime() < 10 * 60 * 1000) {
                return await this.toPayload(existing, issue);
            }
        }

        const context = await this.buildContextPack(issue);
        const city = (context.listing as any)?.city || null;
        const ticketLane = this.classifyTicketLane(issue);
        if (!city) {
            logger.info(`[IssueAIService] issue #${issueId} city unresolved (listing_id=${issue.listing_id})`);
        }

        // Best-effort: seed city defaults + warm memory from completed tickets/contacts.
        await this.ensurePortfolioCityDefaults(city).catch(() => undefined);
        void this.hydrateVendorMemoryForCity(
            city,
            ticketLane.needsVendorDispatch ? issue.category || null : null
        ).catch(() => undefined);

        const portfolioVendors = await this.loadPortfolioVendors({
            city,
            category: issue.category || null,
            ticketLane,
        });
        const upsellGuidance = await this.loadUpsellGuidance(issue, context);
        const specialRules = await this.loadSpecialRulesGuidance(issue, context, ticketLane);
        const heuristicContacts = this.finalizeRecommendedContacts(
            this.mergePortfolioVendorsIntoContacts(
                this.rankContacts(issue, context, ticketLane),
                portfolioVendors
            ),
            city,
            ticketLane
        );
        const listingIdForFeedback = this.parsePositiveInt(issue.listing_id) || this.parsePositiveInt((context.listing as any)?.id);
        const recentFeedback = await this.loadRecentFeedback(listingIdForFeedback);
        const clarifyingQuestionsSeed = this.buildClarifyingQuestions(
            issue,
            heuristicContacts,
            portfolioVendors,
            ticketLane,
            upsellGuidance,
            specialRules
        );

        let modelOut: any = null;
        let rawResponse: string | null = null;

        if (this.openai) {
            try {
                const systemParts = [
                    "You are the SecureStay Issue Resolution Copilot for guest property tickets.",
                    "Return ONLY valid JSON with keys:",
                    "summary (string), severity (critical|high|medium|low), primaryAction (string),",
                    "playbook (array of {step, ownerLane, detail}),",
                    "contactHints (array of {role, nameHint, reason} — names must match provided contacts/portfolioVendors when possible),",
                    "clarifyingQuestions (string[] — ask the human when facts are missing; empty if not needed),",
                    "draftGuestMessage, draftInternalNote, draftVendorMessage, warnings (string[]), confidence (0-100).",
                    "ownerLane must be one of: IR, GR, vendor, owner, guest, ops.",
                    "IR = Issue Resolution / maintenance lane; GR = Guest Relations lane.",
                    "Never invent access codes, refund amounts, vendor ETAs, phones, or vendor names not in context.",
                    "Keep drafts short, professional, and actionable. No auto-send — human will review.",
                    "If guest is in-house, prioritize safety/access/comfort and fast contact.",
                    "Treat recentTeamFeedback correctedResponse as preferred playbook/draft wording for this listing.",
                ];
                if (ticketLane.isRefundOrCancel) {
                    systemParts.push(
                        "This is a REFUND/CANCELLATION Guest Relations ticket.",
                        "Do NOT hunt vendors. Escalate to GR managers (Anj/Jade) — task + notification already route there.",
                        "primaryAction should say escalate to GR managers / Mitigation; drafts should be holding language only."
                    );
                } else if (ticketLane.isAccessIssue) {
                    systemParts.push(
                        "This is a PROPERTY ACCESS / door-code ticket.",
                        "HARD ORDER: 1) listing KB/SOP for door codes (Schlage last-4-of-phone patterns etc.), 2) guide guest through entry steps, 3) only then escalate to lock vendor/cleaner if still locked out.",
                        "Never invent access codes. Use only codes/procedures present in specialRules/listingKnowledge or prior team messages."
                    );
                } else if (ticketLane.isSupplies) {
                    systemParts.push(
                        "This is a SUPPLIES ticket — contact the CLEANER (or supplies orderer if known), NOT a 'supplies vendor'.",
                        "primaryAction should name the cleaner + phone when available."
                    );
                } else if (ticketLane.lane === "GR" || ticketLane.isReservationChange) {
                    systemParts.push(
                        "This is primarily a Guest Relations ticket, NOT a vendor-dispatch ticket.",
                        "Do NOT ask for a 'RESERVATION CHANGES vendor' or invent a category-named vendor.",
                        "HARD ORDER for early check-in / late checkout / reservation changes:",
                        "1) specialRules (listing KB/SOP, ops overrides, early/late handling) — follow any property-specific instructions first.",
                        "2) upsellGuidance (fee, SDTO, autoRespond, internalNotes) — SDTO wins over Settings when present.",
                        "3) Verify turnover: Launch/10% launch clients (specialRules.isLaunchClient) → contact OWNER; otherwise contact CLEANER. Skip only if Upsells already AUTO-DECLINE.",
                        "4) Contact/reply to the guest LAST with quote, decline, or 'team will confirm'.",
                        "Fee presence does NOT mean approved. Never promise a clock time unless TEAM already confirmed.",
                        "primaryAction MUST follow that 1→2→3→4 order in one sentence."
                    );
                } else {
                    systemParts.push(
                        "If portfolioVendors or contacts include a matching vendor, primaryAction MUST name them and their phone when available.",
                        "If no vendor/phone is available for an IR dispatch ticket, primaryAction should say we need the vendor identity/number, and clarifyingQuestions must ask for it.",
                        "Prefer calling vendors/cleaners before promising guest outcomes."
                    );
                }
                const response = await this.openai.chat.completions.create({
                    model: MODEL,
                    temperature: 0.2,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content: systemParts.join(" "),
                        },
                        {
                            role: "user",
                            content: JSON.stringify({
                                ticketLane,
                                decisionOrder: [
                                    "specialRules",
                                    "upsellGuidance",
                                    "contactCleanerOwnerVendorIfNeeded",
                                    "contactGuestLast",
                                ],
                                issue: context.issue,
                                updates: context.updates,
                                reservation: context.reservation,
                                listing: context.listing,
                                specialRules,
                                upsellGuidance,
                                contacts: heuristicContacts,
                                portfolioVendors,
                                clarifyingQuestionsSeed,
                                recentMessages: context.recentMessages,
                                similarHints: context.similarHints,
                                similarIssues: context.similarIssues,
                                recentTeamFeedback: recentFeedback,
                            }),
                        },
                    ],
                });
                rawResponse = response.choices?.[0]?.message?.content || null;
                if (rawResponse) modelOut = JSON.parse(rawResponse);
            } catch (err: any) {
                logger.warn(`[IssueAIService] suggest model failed for issue ${issueId}: ${err?.message}`);
            }
        }

        const playbook = this.normalizePlaybook(
            modelOut?.playbook,
            issue,
            ticketLane,
            upsellGuidance,
            specialRules
        );
        let recommendedContacts = this.mergeContactHints(heuristicContacts, modelOut?.contactHints);
        recommendedContacts = this.mergePortfolioVendorsIntoContacts(recommendedContacts, portfolioVendors);
        recommendedContacts = this.finalizeRecommendedContacts(recommendedContacts, city, ticketLane);
        const clarifyingQuestions = this.buildClarifyingQuestions(
            issue,
            recommendedContacts,
            portfolioVendors,
            ticketLane,
            upsellGuidance,
            specialRules
        );
        const warnings = this.normalizeStringArray(modelOut?.warnings);
        if (!context.reservation) warnings.push("No linked reservation — guest stay context may be incomplete.");
        if (
            ticketLane.needsVendorDispatch &&
            !recommendedContacts.some(
                (c) =>
                    (c.source === "contact" || c.source === "poc" || c.source === "memory") &&
                    (c.phone || c.email)
            )
        ) {
            warnings.push("No usable vendor phone/email — ask the team who we use and teach IR Copilot.");
        }
        for (const tip of this.buildUpsellWarnings(upsellGuidance, ticketLane)) {
            if (!warnings.includes(tip)) warnings.push(tip);
        }

        // Prefer city-scoped portfolio cleaners over listing contacts from other markets.
        const portfolioCleaner = portfolioVendors.find(
            (v) => v.phone && /clean/i.test(`${v.role || ""} ${v.name || ""} ${v.category || ""}`)
        );
        const topCleanerContact = recommendedContacts.find(
            (c) =>
                (c.source === "memory" || c.source === "poc" || c.source === "contact") &&
                c.phone &&
                /clean/i.test(`${c.role} ${c.name} ${c.reason}`)
        );
        const topOwner = recommendedContacts.find((c) => c.source === "owner" && (c.phone || c.email || c.name));
        const topVendor = recommendedContacts.find(
            (c) => (c.source === "memory" || c.source === "poc" || c.source === "contact") && (c.phone || c.name)
        );
        let primaryAction = String(modelOut?.primaryAction || "").trim();
        const earlyUpsell = upsellGuidance.find((u) => u.isEarlyCheckin);
        const lateUpsell = upsellGuidance.find((u) => u.isLateCheckout);
        if (ticketLane.isRefundOrCancel) {
            primaryAction =
                "Escalate refund/cancellation to GR managers (Anj/Jade) — task + notification + Mitigation; do not dispatch vendors.";
        } else if (ticketLane.isAccessIssue) {
            primaryAction =
                (specialRules.listingKnowledge || []).length > 0
                    ? "Follow listing door-code SOP / KB with the guest; never invent codes; escalate to lock vendor only if still locked out."
                    : topVendor?.phone
                      ? `Walk guest through entry steps from KB/messages; if still locked out call ${topVendor.name} at ${topVendor.phone}.`
                      : "Walk guest through entry steps from listing KB/messages; confirm door-code procedure; escalate to lock vendor/cleaner only if still locked out.";
        } else if (ticketLane.isSupplies) {
            const suppliesCleaner = portfolioCleaner || topCleanerContact;
            primaryAction = suppliesCleaner?.phone
                ? `Contact cleaner ${suppliesCleaner.name} at ${suppliesCleaner.phone} about missing supplies (cleaner restock — not a trade vendor).`
                : "Contact the listing cleaner about missing supplies (cleaner restock — not a trade vendor).";
        } else if (ticketLane.isEarlyCheckinAsk || ticketLane.isLateCheckoutAsk || ticketLane.isReservationChange) {
            // Enforce decision order even if the model reorders steps.
            // Prefer city-scoped portfolio cleaner for turnover confirmation.
            const turnoverCleaner: IrRecommendedContact | undefined = portfolioCleaner
                ? {
                      rank: 1,
                      role: "Cleaner",
                      name: portfolioCleaner.name,
                      phone: portfolioCleaner.phone,
                      email: portfolioCleaner.email || null,
                      reason: "portfolio memory",
                      contactId: null,
                      source: "memory",
                  }
                : topCleanerContact;
            primaryAction = this.buildReservationChangePrimaryAction({
                ticketLane,
                specialRules,
                earlyUpsell,
                lateUpsell,
                topCleaner: turnoverCleaner,
                topOwner,
            });
        } else if (
            ticketLane.needsVendorDispatch &&
            topVendor?.name &&
            topVendor.phone &&
            !/^\d/.test(primaryAction) &&
            !primaryAction.toLowerCase().includes(topVendor.name.toLowerCase().slice(0, 8))
        ) {
            primaryAction = `Call ${topVendor.name} at ${topVendor.phone} about this ${issue.category || "issue"}.`;
        } else if (!primaryAction) {
            primaryAction =
                clarifyingQuestions[0]?.question ||
                playbook[0]?.step ||
                "Review ticket and contact the top recommended person.";
        }

        // Mark prior open suggestions regenerated.
        await this.suggestionRepo
            .createQueryBuilder()
            .update(IssueAISuggestionEntity)
            .set({ status: "regenerated" })
            .where("issueId = :issueId AND status = :status", { issueId, status: "suggested" })
            .execute();

        const row = this.suggestionRepo.create({
            issueId,
            listingId: this.parsePositiveInt(issue.listing_id) || this.parsePositiveInt((context.listing as any)?.id),
            reservationId: this.parsePositiveInt(issue.reservation_id),
            summary: String(modelOut?.summary || issue.ai_short_title || issue.issue_description || "").trim().slice(0, 2000) || null,
            severity: this.normalizeSeverity(modelOut?.severity, issue),
            primaryAction: primaryAction.slice(0, 1000),
            playbookJson: JSON.stringify(playbook),
            recommendedContactsJson: JSON.stringify(recommendedContacts),
            draftGuestMessage: String(modelOut?.draftGuestMessage || "").trim() || null,
            draftInternalNote: String(modelOut?.draftInternalNote || "").trim() || null,
            draftVendorMessage: String(modelOut?.draftVendorMessage || "").trim() || null,
            warningsJson: JSON.stringify(warnings),
            confidence: Number.isFinite(Number(modelOut?.confidence)) ? Number(modelOut.confidence) : null,
            modelName: this.openai ? MODEL : "heuristic",
            promptVersion: PROMPT_VERSION,
            status: "suggested",
            rawResponse,
            generatedAt: new Date(),
        });
        const saved = await this.suggestionRepo.save(row);
        return await this.toPayload(saved, issue);
    }

    async submitFeedback(input: {
        suggestionId?: number | null;
        issueId?: number | null;
        userId?: number | null;
        rating?: "up" | "down" | null;
        categories?: string[];
        feedbackText?: string | null;
        correctedResponse?: string | null;
    }) {
        let suggestion: IssueAISuggestionEntity | null = null;
        if (input.suggestionId) {
            suggestion = await this.suggestionRepo.findOne({ where: { id: Number(input.suggestionId) } });
        }
        const issueId = Number(input.issueId || suggestion?.issueId) || null;
        if (!issueId && !suggestion) {
            throw CustomErrorHandler.validationError("suggestionId or issueId is required");
        }

        const feedback = this.feedbackRepo.create({
            suggestionId: suggestion?.id ?? (input.suggestionId ? Number(input.suggestionId) : null),
            issueId,
            listingId: suggestion?.listingId ?? null,
            userId: input.userId ?? null,
            rating: input.rating || null,
            categories: input.categories?.length ? JSON.stringify(input.categories) : null,
            feedbackText: input.feedbackText?.trim() || null,
            correctedResponse: input.correctedResponse?.trim() || null,
        });
        const saved = await this.feedbackRepo.save(feedback);

        if (suggestion && input.rating === "up") {
            suggestion.status = input.correctedResponse?.trim() ? "edited" : "accepted";
            await this.suggestionRepo.save(suggestion);
        } else if (suggestion && input.rating === "down") {
            suggestion.status = "ignored";
            await this.suggestionRepo.save(suggestion);
        }

        // Teach portfolio memory when feedback includes a vendor/phone correction.
        try {
            const issue = issueId ? await this.issueRepo.findOne({ where: { id: issueId } }) : null;
            const taught = this.extractVendorFromText(
                `${input.correctedResponse || ""}\n${input.feedbackText || ""}`
            );
            if (issue && taught?.name) {
                const lid = this.parsePositiveInt(issue.listing_id);
                const listing = lid
                    ? await this.listingRepo.findOne({ where: { id: lid }, withDeleted: true })
                    : null;
                const city = await this.resolveListingCity(listing, issue);
                await this.upsertVendorMemory({
                    vendorName: taught.name,
                    phone: taught.phone,
                    email: taught.email,
                    category: issue.category || null,
                    city,
                    role: issue.category || "Vendor",
                    source: "feedback",
                    sourceIssueId: issue.id,
                    notes: input.feedbackText || null,
                });
            }
        } catch (err: any) {
            logger.warn(`[IssueAIService] feedback vendor teach skipped: ${err?.message}`);
        }

        return saved;
    }

    /**
     * Human answers "who is the vendor / what's the number?" and we persist
     * portfolio memory, then regenerate the suggestion.
     */
    async teachVendor(
        issueId: number,
        input: { name: string; phone?: string | null; email?: string | null; notes?: string | null }
    ): Promise<IrSuggestionPayload> {
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);
        const name = String(input.name || "").trim();
        if (!name) throw CustomErrorHandler.validationError("Vendor name is required");

        const lid = this.parsePositiveInt(issue.listing_id);
        const listing = lid
            ? await this.listingRepo.findOne({ where: { id: lid }, withDeleted: true })
            : null;
        const city = await this.resolveListingCity(listing, issue);

        await this.upsertVendorMemory({
            vendorName: name,
            phone: input.phone ? String(input.phone).trim() : null,
            email: input.email ? String(input.email).trim() : null,
            category: issue.category || null,
            city,
            role: issue.category || "Vendor",
            source: "teach",
            sourceIssueId: issue.id,
            notes: input.notes || null,
        });

        if (!issue.final_contractor_name) {
            issue.final_contractor_name = name;
            await this.issueRepo.save(issue);
        }

        await this.logSystemUpdate(
            issue,
            `IR Copilot taught vendor: ${name}${input.phone ? ` · ${input.phone}` : ""}${input.email ? ` · ${input.email}` : ""}`,
            "system"
        );

        return this.suggest(issueId, { force: true });
    }

    async updateSuggestionStatus(id: number, status: string) {
        const row = await this.suggestionRepo.findOne({ where: { id } });
        if (!row) throw CustomErrorHandler.notFound("Suggestion not found");
        row.status = status;
        return this.suggestionRepo.save(row);
    }

    // -------------------------------------------------------------------------
    // Context + ranking
    // -------------------------------------------------------------------------

    private async buildContextPack(issue: Issue) {
        const updates = await this.updatesRepo
            .createQueryBuilder("u")
            .where("u.issueId = :issueId", { issueId: issue.id })
            .andWhere("u.deletedAt IS NULL")
            .orderBy("u.createdAt", "DESC")
            .take(25)
            .getMany();

        const listingId = this.parsePositiveInt(issue.listing_id);
        let listing = listingId
            ? await this.listingRepo.findOne({ where: { id: listingId }, withDeleted: true })
            : null;

        const reservationId = this.parsePositiveInt(issue.reservation_id);
        const reservation = reservationId
            ? await this.reservationRepo.findOne({ where: { id: reservationId } })
            : null;

        // Fallback: resolve listing via reservation.listingMapId when issue.listing_id is empty/wrong.
        if (!listing && reservation) {
            const resListingId = this.parsePositiveInt((reservation as any).listingMapId);
            if (resListingId) {
                listing = await this.listingRepo.findOne({ where: { id: resListingId }, withDeleted: true });
            }
        }
        // Last resort: match by listing display name (many AI tickets have orphan listing_id strings).
        if (!listing && issue.listing_name) {
            const name = String(issue.listing_name).trim();
            if (name) {
                listing = await this.listingRepo
                    .createQueryBuilder("l")
                    .where("l.internalListingName = :name OR l.name = :name OR l.externalListingName = :name", {
                        name,
                    })
                    .withDeleted()
                    .orderBy("l.deletedAt", "ASC")
                    .getOne();
            }
        }

        const resolvedCity = await this.resolveListingCity(listing, issue);

        // Prefer resolved listing id so orphan issue.listing_id strings don't load wrong/empty contacts.
        const contactListingId = this.parsePositiveInt(listing?.id) || listingId;
        const contacts = contactListingId
            ? await this.contactRepo.find({
                  where: { listingId: String(contactListingId) },
                  take: 80,
              })
            : [];

        let recentMessages: Array<{ at: string; direction: string; body: string }> = [];
        if (reservationId) {
            try {
                const conv = await this.conversationRepo.findOne({
                    where: { reservationId },
                    order: { lastMessageAt: "DESC" },
                });
                if (conv?.threadId) {
                    const msgs = await this.messageRepo.find({
                        where: { threadId: Number(conv.threadId) },
                        order: { sentAt: "DESC" },
                        take: 8,
                    });
                    recentMessages = msgs
                        .filter((m) => m.body?.trim())
                        .map((m) => ({
                            at: m.sentAt ? new Date(m.sentAt).toISOString() : "",
                            direction: m.direction,
                            body: String(m.body || "").slice(0, 400),
                        }));
                }
            } catch {
                /* optional */
            }
        }

        const similarIssues = await this.findSimilarIssues(issue);
        const similarHints = similarIssues.map((s) =>
            [s.title, s.resolution ? `IR note: ${s.resolution}` : null, s.poc ? `POC: ${s.poc}` : null]
                .filter(Boolean)
                .join(" | ")
        );

        const stayStage = this.computeStayStage(reservation || issue);

        return {
            issue: {
                id: issue.id,
                status: issue.status,
                grStatus: issue.gr_status,
                category: issue.category,
                urgency: issue.urgency,
                description: issue.issue_description,
                ownerNotes: issue.owner_notes,
                guestName: issue.guest_name,
                guestPhone: issue.guest_contact_number,
                assignee: issue.assignee,
                finalContractorName: issue.final_contractor_name,
                aiShortTitle: issue.ai_short_title,
                aiChecklist: this.parseJsonArray(issue.ai_checklist),
                stayStage,
                channel: issue.channel,
            },
            updates: updates
                .slice()
                .reverse()
                .map((u) => ({
                    at: u.createdAt,
                    source: u.source,
                    by: u.createdBy,
                    text: String(u.updates || "").slice(0, 500),
                })),
            reservation: reservation
                ? {
                      id: reservation.id,
                      guestName: reservation.guestName,
                      phone: reservation.phone,
                      email: reservation.guestEmail,
                      arrivalDate: reservation.arrivalDate,
                      departureDate: reservation.departureDate,
                      status: reservation.status,
                  }
                : null,
            listing: listing
                ? {
                      id: listing.id,
                      name: listing.internalListingName || listing.name,
                      city: resolvedCity,
                      cityRaw: listing.city || null,
                      address: listing.address || null,
                      state: listing.state || null,
                      tags: listing.tags || null,
                      ownerName: listing.ownerName,
                      ownerPhone: listing.ownerPhone,
                      ownerEmail: listing.ownerEmail,
                  }
                : { id: listingId || null, name: issue.listing_name, city: resolvedCity, tags: null },
            contacts,
            recentMessages,
            similarHints,
            similarIssues,
        };
    }

    private async findSimilarIssues(issue: Issue): Promise<IrSimilarIssue[]> {
        const listingId = Number(issue.listing_id);
        if (!issue.category) return [];
        try {
            // Prefer same listing, then expand to same city + category.
            const sameListing = Number.isFinite(listingId)
                ? await this.issueRepo.find({
                      where: {
                          listing_id: String(listingId),
                          category: issue.category,
                          status: "Completed",
                      },
                      order: { id: "DESC" },
                      take: 5,
                  })
                : [];

            let cityPeers: Issue[] = [];
            const listing = Number.isFinite(listingId)
                ? await this.listingRepo.findOne({ where: { id: listingId }, withDeleted: true })
                : null;
            const city = await this.resolveListingCity(listing, issue);
            if (city) {
                const rows: any[] = await appDatabase.query(
                    `SELECT i.id, i.ai_short_title AS ai_short_title, i.issue_description AS issue_description,
                            i.resolution, i.final_contractor_name AS final_contractor_name, i.category
                     FROM issues i
                     INNER JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
                     WHERE i.deleted_at IS NULL
                       AND i.status = 'Completed'
                       AND i.category = ?
                       AND (
                         LOWER(TRIM(l.city)) = LOWER(?)
                         OR LOWER(l.address) LIKE LOWER(CONCAT('%, ', ?, ', %'))
                       )
                       AND i.id <> ?
                     ORDER BY i.id DESC
                     LIMIT 8`,
                    [issue.category, city, city, issue.id]
                );
                cityPeers = (rows || []).map((r) => r as Issue);
            }

            const seen = new Set<number>();
            const merged: Issue[] = [];
            for (const s of [...sameListing, ...cityPeers]) {
                const id = Number((s as any).id);
                if (!id || id === issue.id || seen.has(id)) continue;
                seen.add(id);
                merged.push(s as Issue);
                if (merged.length >= 5) break;
            }

            return merged.map((s) => ({
                id: Number((s as any).id),
                title: String((s as any).ai_short_title || (s as any).issue_description || `Issue #${(s as any).id}`).slice(0, 120),
                resolution: (s as any).resolution ? String((s as any).resolution).slice(0, 200) : null,
                poc: (s as any).final_contractor_name ? String((s as any).final_contractor_name) : null,
                category: (s as any).category || null,
            }));
        } catch {
            return [];
        }
    }

    private classifyTicketLane(issue: Issue): IrTicketLane {
        const category = String(issue.category || "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, " ");
        const text = `${issue.ai_short_title || ""} ${issue.issue_description || ""} ${issue.owner_notes || ""}`.toLowerCase();
        const isEarlyCheckinAsk =
            /early\s*check[\s-]*in|check[\s-]*in\s*early|arrive\s*early|earlier\s*arrival|eci\b/.test(text);
        const isLateCheckoutAsk =
            /late\s*check[\s-]*out|check[\s-]*out\s*late|depart\s*late|later\s*departure|lco\b/.test(text);
        const isReservationChange = category === "RESERVATION CHANGES" || isEarlyCheckinAsk || isLateCheckoutAsk;
        // Keep aligned with GrRefundEscalationService — category-gated.
        const looksLikeEarlyLate =
            /early\s*check[\s-]*in|late\s*check[\s-]*out|check[\s-]*in\s*early|check[\s-]*out\s*late/.test(text) &&
            !/cancel|cancellation/.test(text);
        const isRefundOrCancel =
            category === "REFUNDS" ||
            (category === "RESERVATION CHANGES" &&
                !looksLikeEarlyLate &&
                /cancel|cancellation|refund|reimburse|compensation|goodwill/.test(text));
        const isSupplies =
            category === "SUPPLIES" ||
            /\b(toilet\s*paper|paper\s*towels|toiletries|missing\s+towels|extra\s+towels|supplies|shampoo|conditioner|trash\s*bags)\b/.test(
                text
            );
        // Word-boundary access signals — avoid matching "clock" / "locked thermostat".
        const isAccessIssue =
            category === "PROPERTY ACCESS" ||
            /\b(lockout|access\s*code|can't\s*get\s*in|cant\s*get\s*in|door\s*code|keypad|entry\s*code|schlage)\b/.test(
                text
            ) ||
            (category !== "MAINTENANCE" &&
                category !== "HVAC" &&
                /\b(lock\s*box|smart\s*lock|door\s*lock)\b/.test(text));
        const lane: IrTicketLane["lane"] = GR_CATEGORIES.has(category)
            ? "GR"
            : IR_CATEGORIES.has(category)
              ? "IR"
              : "unknown";
        // Supplies → cleaner (not trade vendor). Refunds/access/GR → no vendor hunt.
        const needsVendorDispatch =
            !isRefundOrCancel &&
            !isAccessIssue &&
            !isSupplies &&
            (lane === "IR" ||
                (lane === "unknown" &&
                    !isReservationChange &&
                    /maint|hvac|plumb|clean|pest|pool|leak|broken|repair/.test(text)));
        return {
            lane,
            isReservationChange,
            isEarlyCheckinAsk,
            isLateCheckoutAsk,
            isRefundOrCancel,
            isSupplies,
            isAccessIssue,
            needsVendorDispatch,
        };
    }

    private async loadUpsellGuidance(
        issue: Issue,
        context: Awaited<ReturnType<IssueAIService["buildContextPack"]>>
    ): Promise<IrUpsellGuidance[]> {
        const listingId =
            this.parsePositiveInt(issue.listing_id) || this.parsePositiveInt((context.listing as any)?.id);
        if (!listingId) return [];
        const lane = this.classifyTicketLane(issue);
        if (!lane.isReservationChange && !lane.isEarlyCheckinAsk && !lane.isLateCheckoutAsk) {
            return [];
        }
        try {
            const { UpsellQuoteService } = require("./UpsellQuoteService");
            const quotes = await new UpsellQuoteService().listQuotesForListing({
                listingId,
                checkin: context.reservation?.arrivalDate
                    ? String(context.reservation.arrivalDate)
                    : null,
                checkout: context.reservation?.departureDate
                    ? String(context.reservation.departureDate)
                    : null,
                reservationId: context.reservation?.id ?? null,
            });
            return (quotes || [])
                .filter((q: any) => q.isEarlyCheckin || q.isLateCheckout)
                .map(
                    (q: any): IrUpsellGuidance => ({
                        title: String(q.title || ""),
                        guestFee: q.guestFee != null ? Number(q.guestFee) : null,
                        sdto: String(q.sdto || "unknown"),
                        autoRespond: String(q.autoRespond || "quote"),
                        sameDayTurnoverRelevant: Boolean(q.sameDayTurnoverRelevant),
                        isEarlyCheckin: Boolean(q.isEarlyCheckin),
                        isLateCheckout: Boolean(q.isLateCheckout),
                        breakdown: Array.isArray(q.breakdown) ? q.breakdown.map(String).slice(0, 6) : [],
                        internalNotes: q.internalNotes ? String(q.internalNotes).slice(0, 500) : null,
                    })
                );
        } catch (err: any) {
            logger.warn(`[IssueAIService] loadUpsellGuidance skipped: ${err?.message}`);
            return [];
        }
    }

    private async loadSpecialRulesGuidance(
        issue: Issue,
        context: Awaited<ReturnType<IssueAIService["buildContextPack"]>>,
        ticketLane: IrTicketLane
    ): Promise<IrSpecialRulesGuidance> {
        const listingTags = String((context.listing as any)?.tags || "").trim() || null;
        const tagTokens = (listingTags || "")
            .split(/[,;|]/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean);
        const isLaunchClient =
            tagTokens.includes("launch") ||
            tagTokens.some((t) => t === "10%" || t === "10" || /^10\s*%$/.test(t));
        const turnoverContactRole: "owner" | "cleaner" = isLaunchClient ? "owner" : "cleaner";

        const empty: IrSpecialRulesGuidance = {
            earlyCheckinHandling: "defer_to_team",
            lateCheckoutHandling: "defer_to_team",
            opsOverrides: [],
            listingKnowledge: [],
            summaryLines: [],
            listingTags,
            isLaunchClient,
            turnoverContactRole,
        };
        const wantsEarlyLate =
            ticketLane.isReservationChange || ticketLane.isEarlyCheckinAsk || ticketLane.isLateCheckoutAsk;
        const wantsAccessKb = ticketLane.isAccessIssue;
        if (!wantsEarlyLate && !wantsAccessKb) {
            return empty;
        }

        let earlyCheckinHandling = "defer_to_team";
        let lateCheckoutHandling = "defer_to_team";
        if (wantsEarlyLate) {
            try {
                const { AIMessagingSettingsService } = require("./AIMessagingSettingsService");
                const settings = await new AIMessagingSettingsService().getGlobalCached();
                earlyCheckinHandling = String(settings?.earlyCheckinHandling || "defer_to_team");
                lateCheckoutHandling = String(settings?.lateCheckoutHandling || "defer_to_team");
            } catch (err: any) {
                logger.warn(`[IssueAIService] specialRules settings skipped: ${err?.message}`);
            }
        }

        const opsOverrides: IrSpecialRulesGuidance["opsOverrides"] = [];
        const listingId =
            this.parsePositiveInt(issue.listing_id) || this.parsePositiveInt((context.listing as any)?.id);
        if (wantsEarlyLate && listingId) {
            try {
                const { ListingOpsOverrideService } = require("./ListingOpsOverrideService");
                const rows = await new ListingOpsOverrideService().getForListings([listingId]);
                for (const o of rows || []) {
                    if (!/early_checkin|late_checkout|checkin_time|checkout_time/i.test(String(o.field || ""))) {
                        continue;
                    }
                    opsOverrides.push({
                        field: String(o.field),
                        value: o.value != null ? String(o.value) : null,
                        status: String(o.status || "active"),
                        note: o.note ? String(o.note).slice(0, 240) : null,
                    });
                }
            } catch (err: any) {
                logger.warn(`[IssueAIService] specialRules opsOverrides skipped: ${err?.message}`);
            }
        }

        const listingKnowledge: string[] = [];
        if (Number.isFinite(listingId) && listingId > 0) {
            try {
                // Staff-facing IR Copilot may use INTERNAL KB (owner preferences / SOPs).
                const accessClause = wantsAccessKb
                    ? `OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%door%code%'
                       OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%access%code%'
                       OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%schlage%'
                       OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%lockout%'
                       OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%entry%code%'
                       OR LOWER(COALESCE(category,'')) LIKE '%access%'`
                    : "";
                const earlyLateClause = wantsEarlyLate
                    ? `LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%early%check%'
                         OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%late%check%'
                         OR LOWER(CONCAT(COALESCE(category,''),' ',COALESCE(title,''),' ',COALESCE(content,'')))
                           LIKE '%turnover%'
                         OR LOWER(COALESCE(category,'')) LIKE '%must%know%'
                         OR LOWER(COALESCE(category,'')) LIKE '%sop%'
                         OR LOWER(COALESCE(title,'')) LIKE '%special%'`
                    : "0=1";
                const rows: any[] = await appDatabase.query(
                    `SELECT visibility, category, title, content
                     FROM listing_knowledge_entries
                     WHERE listingId = ? AND isArchived = 0
                       AND (
                         ${earlyLateClause}
                         ${accessClause}
                       )
                     ORDER BY (visibility = 'internal') DESC, id DESC
                     LIMIT 8`,
                    [listingId]
                );
                for (const r of rows || []) {
                    const head = [r.visibility, r.category, r.title].filter(Boolean).join(" · ");
                    const body = String(r.content || "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 280);
                    if (!body) continue;
                    listingKnowledge.push(`[${head}] ${body}`);
                }
            } catch (err: any) {
                logger.warn(`[IssueAIService] specialRules listingKnowledge skipped: ${err?.message}`);
            }
        }

        const summaryLines: string[] = [];
        if (opsOverrides.length) {
            for (const o of opsOverrides) {
                summaryLines.push(
                    `Ops override ${o.field}: ${o.status}${o.value != null ? ` = ${o.value}` : ""}${
                        o.note ? ` (${o.note})` : ""
                    }`
                );
            }
        }
        if (wantsEarlyLate) {
            if (ticketLane.isEarlyCheckinAsk || (!ticketLane.isLateCheckoutAsk && ticketLane.isReservationChange)) {
                summaryLines.push(`Global earlyCheckinHandling: ${earlyCheckinHandling}`);
            }
            if (ticketLane.isLateCheckoutAsk || ticketLane.isReservationChange) {
                summaryLines.push(`Global lateCheckoutHandling: ${lateCheckoutHandling}`);
            }
            if (isLaunchClient) {
                summaryLines.push(
                    `Launch/10% client (tags: ${listingTags}) — verify early/late with OWNER, not cleaner.`
                );
            } else {
                summaryLines.push("Non-Launch client — verify early/late turnover with CLEANER.");
            }
        }
        if (wantsAccessKb) {
            summaryLines.push(
                listingKnowledge.length
                    ? `${listingKnowledge.length} door-code / access KB note(s) loaded — use these; never invent codes.`
                    : "No door-code SOP in listing KB — confirm Schlage/last-4 or lock vendor procedure with team before promising a code."
            );
        }
        if (listingKnowledge.length && wantsEarlyLate) {
            summaryLines.push(`${listingKnowledge.length} listing special-rule KB note(s) loaded`);
        }
        if (!summaryLines.length) {
            summaryLines.push("No listing-specific special rules found — fall through to Upsells + Settings handling.");
        }

        return {
            earlyCheckinHandling,
            lateCheckoutHandling,
            opsOverrides,
            listingKnowledge,
            summaryLines,
            listingTags,
            isLaunchClient,
            turnoverContactRole,
        };
    }

    private buildReservationChangePrimaryAction(opts: {
        ticketLane: IrTicketLane;
        specialRules: IrSpecialRulesGuidance;
        earlyUpsell?: IrUpsellGuidance;
        lateUpsell?: IrUpsellGuidance;
        topCleaner?: IrRecommendedContact | undefined;
        topOwner?: IrRecommendedContact | undefined;
    }): string {
        const { ticketLane, specialRules, earlyUpsell, lateUpsell, topCleaner, topOwner } = opts;
        const relevant =
            ticketLane.isLateCheckoutAsk && !ticketLane.isEarlyCheckinAsk
                ? lateUpsell
                : earlyUpsell || lateUpsell;
        const handling = ticketLane.isLateCheckoutAsk && !ticketLane.isEarlyCheckinAsk
            ? specialRules.lateCheckoutHandling
            : specialRules.earlyCheckinHandling;

        const override = specialRules.opsOverrides.find((o) =>
            ticketLane.isLateCheckoutAsk && !ticketLane.isEarlyCheckinAsk
                ? /late_checkout/i.test(o.field)
                : /early_checkin/i.test(o.field)
        );
        const step1 =
            override?.status === "quarantined"
                ? `1) Special rules: ${override.field} quarantined — do not quote PMS/Upsells fee; escalate`
                : override?.status === "active" && override.value != null
                  ? `1) Special rules: use ops override ${override.field}=${override.value}`
                  : specialRules.listingKnowledge.length
                    ? `1) Special rules: apply listing KB/SOP (${specialRules.listingKnowledge.length} note(s)); handling=${handling}`
                    : `1) Special rules: handling=${handling}${
                          specialRules.isLaunchClient ? "; Launch client → owner for turnover" : ""
                      }`;

        const step2 =
            relevant?.autoRespond === "deny"
                ? `2) Upsells: AUTO-DECLINE ${relevant.title} (SDTO not allowed + same-day turnover)`
                : relevant?.guestFee != null
                  ? `2) Upsells: ${relevant.title} $${Number(relevant.guestFee).toFixed(2)} (SDTO ${relevant.sdto}, ${relevant.autoRespond})`
                  : relevant
                    ? `2) Upsells: ${relevant.title} fee TBD (SDTO ${relevant.sdto}, ${relevant.autoRespond})`
                    : "2) Upsells: no early/late config — confirm fee/policy before quoting";

        // Always verify turnover unless Upsells already auto-declines.
        const needsContact = relevant?.autoRespond !== "deny";
        let step3: string;
        if (!needsContact) {
            step3 = "3) No turnover call needed — Upsells already auto-declines";
        } else if (specialRules.turnoverContactRole === "owner") {
            step3 = topOwner?.phone
                ? `3) Launch client: confirm with owner ${topOwner.name} at ${topOwner.phone}`
                : topOwner?.name
                  ? `3) Launch client: confirm with owner ${topOwner.name} (get phone if missing)`
                  : "3) Launch client: confirm with property owner (phone missing on listing)";
        } else {
            step3 = topCleaner
                ? `3) Confirm turnover with cleaner ${topCleaner.name} at ${topCleaner.phone}`
                : "3) Confirm turnover with listing cleaner";
        }

        const step4 =
            relevant?.autoRespond === "deny"
                ? "4) Reply to guest: decline early/late for this stay"
                : "4) Reply to guest last: quote / decline / team will confirm (no clock-time promise)";

        return `${step1}. ${step2}. ${step3}. ${step4}.`;
    }

    private buildUpsellWarnings(upsells: IrUpsellGuidance[], lane: IrTicketLane): string[] {
        if (!lane.isReservationChange && !lane.isEarlyCheckinAsk && !lane.isLateCheckoutAsk) return [];
        const out: string[] = [];
        const relevant = upsells.filter((u) =>
            lane.isEarlyCheckinAsk
                ? u.isEarlyCheckin
                : lane.isLateCheckoutAsk
                  ? u.isLateCheckout
                  : u.isEarlyCheckin || u.isLateCheckout
        );
        if (!relevant.length) {
            out.push("No Early Check-In / Late Check-Out upsell configured on Upsells for this listing.");
            return out;
        }
        for (const u of relevant) {
            if (u.guestFee != null) {
                out.push(`${u.title}: guest fee $${Number(u.guestFee).toFixed(2)} (from Upsells).`);
            }
            if (u.sdto === "needs_confirmation" || u.autoRespond === "escalate") {
                out.push(`${u.title}: SDTO needs confirmation — check cleaner/turnover before promising.`);
            } else if (u.sdto === "not_allowed" && u.sameDayTurnoverRelevant) {
                out.push(`${u.title}: SDTO Not Allowed with same-day turnover — likely decline.`);
            } else if (u.sdto === "unknown" || !u.sdto) {
                out.push(`${u.title}: SDTO blank — treat as quote path; still confirm turnover with cleaner.`);
            }
        }
        return out;
    }

    private isUsableCity(city: string | null | undefined): boolean {
        const c = String(city || "").trim();
        if (!c) return false;
        if (/^\(?\s*not\s*specified\s*\)?$/i.test(c)) return false;
        if (/^n\/?a$/i.test(c)) return false;
        if (/^unknown/i.test(c)) return false;
        if (c.length < 2) return false;
        return true;
    }

    private extractCityFromAddress(address: string | null | undefined): string | null {
        const a = String(address || "").replace(/\s+/g, " ").trim();
        if (!a) return null;
        // "123 Main St, Chicago, IL 60601" / "…, Tampa, FL"
        const m = a.match(/,\s*([A-Za-z][A-Za-z .'-]{1,40})\s*,\s*[A-Z]{2}\b/);
        if (m && this.isUsableCity(m[1])) return m[1].trim();
        const m2 = a.match(/^([A-Za-z][A-Za-z .'-]{1,40})\s*,\s*[A-Z]{2}\b/);
        if (m2 && this.isUsableCity(m2[1])) return m2[1].trim();
        return null;
    }

    /**
     * Resolve city from listing_info.city, else parse Hostify/SS address fields.
     * Empty/"(NOT SPECIFIED)" city columns are common — address usually still has the city.
     */
    private async resolveListingCity(
        listing: Listing | null | undefined,
        issue?: Issue | null
    ): Promise<string | null> {
        if (listing) {
            if (this.isUsableCity(listing.city)) return String(listing.city).trim();
            const fromAddr =
                this.extractCityFromAddress(listing.address) ||
                this.extractCityFromAddress(
                    [listing.street, listing.city, listing.state, listing.zipcode]
                        .filter(Boolean)
                        .join(", ")
                );
            if (fromAddr) return fromAddr;
        }

        // Last resort: SQL coalesce from listing_info joined by issue.listing_id.
        const listingId = Number(issue?.listing_id || listing?.id);
        if (Number.isFinite(listingId) && listingId > 0) {
            try {
                const rows: any[] = await appDatabase.query(
                    `SELECT city, address, street, state, zipcode
                     FROM listing_info
                     WHERE id = ?
                     LIMIT 1`,
                    [listingId]
                );
                const row = rows?.[0];
                if (row) {
                    if (this.isUsableCity(row.city)) return String(row.city).trim();
                    const parsed =
                        this.extractCityFromAddress(row.address) ||
                        this.extractCityFromAddress(
                            [row.street, row.city, row.state, row.zipcode].filter(Boolean).join(", ")
                        );
                    if (parsed) return parsed;
                }
            } catch {
                /* ignore */
            }
        }
        return null;
    }

    private parsePositiveInt(raw: unknown): number | null {
        if (raw == null || raw === "") return null;
        const n = typeof raw === "number" ? raw : Number(String(raw).trim());
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }

    private isUsablePersonName(name: string | null | undefined): boolean {
        const n = String(name || "").trim();
        if (!n) return false;
        if (/^(null|undefined|n\/a|none|unknown|\(null\))$/i.test(n)) return false;
        return true;
    }

    private phoneDigits(phone: string | null | undefined): string | null {
        let d = String(phone || "").replace(/\D/g, "");
        // Prefer stripping leading country code from 11+ digit NANP numbers (+1XXXXXXXXXX).
        if (d.length >= 11 && d.startsWith("1")) d = d.slice(-10);
        else if (d.length > 10) d = d.slice(-10);
        return d.length === 10 ? d : null;
    }

    private isBogusPhone(phone: string | null | undefined): boolean {
        const d = this.phoneDigits(phone);
        if (!d) return true;
        if (BOGUS_PHONE_NPAS.has(d.slice(0, 3))) return true;
        if (/^(\d)\1{9}$/.test(d)) return true;
        return false;
    }

    private sanitizePhone(phone: string | null | undefined): string | null {
        if (!phone || this.isBogusPhone(phone)) return null;
        const d = this.phoneDigits(phone);
        if (!d) return null;
        return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }

    /** True when phone NPA clearly belongs to the other OWN market (CHI↔TPA). */
    private isCrossMarketPhone(phone: string | null | undefined, city: string | null | undefined): boolean {
        const region = this.resolveCityRegion(city);
        const d = this.phoneDigits(phone);
        if (!region || !d) return false;
        const a = d.slice(0, 3);
        if (region.id === "chicago" && TPA_MARKET_NPAS.has(a)) return true;
        if (region.id === "tampa" && CHI_MARKET_NPAS.has(a)) return true;
        return false;
    }

    /**
     * Final safety pass: drop null names, strip bogus/cross-market vendor phones,
     * and keep guests from ranking #1 on vendor-dispatch tickets.
     */
    private finalizeRecommendedContacts(
        contacts: IrRecommendedContact[],
        city: string | null | undefined,
        ticketLane: IrTicketLane
    ): IrRecommendedContact[] {
        const scored = contacts
            .filter((c) => this.isUsablePersonName(c.name) || c.source === "assignee")
            .map((c) => {
                let phone = c.phone ? this.sanitizePhone(c.phone) : null;
                let reason = c.reason;
                const vendorLike = c.source === "contact" || c.source === "poc" || c.source === "memory";
                if (phone && vendorLike && this.isCrossMarketPhone(phone, city)) {
                    reason = `${reason || "Listing contact"} · out-of-market NPA — verify before calling`;
                    phone = null;
                }
                const deepPhone = phone ? phone.replace(/[^\d+]/g, "") : null;
                return {
                    contact: {
                        ...c,
                        phone,
                        reason,
                        deepLinks: {
                            call: deepPhone ? `tel:${deepPhone}` : null,
                            sms: deepPhone ? `sms:${deepPhone}` : null,
                            mailto: c.email ? `mailto:${c.email}` : null,
                        },
                    },
                    sort: (() => {
                        let s = 0;
                        if (vendorLike && phone) s += 40;
                        if (c.source === "memory" && phone) s += 20;
                        if (c.source === "poc" && phone) s += 15;
                        if (c.source === "owner" && (phone || c.email)) s += 8;
                        if (c.source === "guest") {
                            // Guest last on vendor dispatch; earlier on pure GR/comms.
                            s += ticketLane.needsVendorDispatch ? -20 : 5;
                        }
                        if (!phone && vendorLike) s -= 10;
                        return s;
                    })(),
                };
            });

        scored.sort((a, b) => b.sort - a.sort);
        return scored.map(({ contact }, i) => ({ ...contact, rank: i + 1 }));
    }

    private resolveCityRegion(city: string | null | undefined): CityRegion | null {
        const key = String(city || "")
            .trim()
            .toLowerCase();
        if (!key) return null;
        return (
            CITY_REGIONS.find((r) => r.cities.some((c) => c.toLowerCase() === key)) ||
            null
        );
    }

    private regionCitiesFor(city: string | null | undefined): string[] {
        const region = this.resolveCityRegion(city);
        if (region) return region.cities;
        const single = String(city || "").trim();
        return single ? [single] : [];
    }

    async ensurePortfolioCityDefaults(city: string | null | undefined): Promise<number> {
        const region = this.resolveCityRegion(city);
        if (!region) return 0;
        let seeded = 0;
        for (const cityName of region.cities) {
            for (const d of region.defaults) {
                try {
                    const existing = await this.vendorMemoryRepo
                        .createQueryBuilder("v")
                        .where("v.normalizedName = :n", { n: this.normalizeVendorKey(d.vendorName) })
                        .andWhere("LOWER(TRIM(v.city)) = LOWER(:city)", { city: cityName })
                        .andWhere("LOWER(TRIM(v.category)) = LOWER(:category)", { category: d.category })
                        .getOne();
                    if (existing?.phone) continue;
                    await this.upsertVendorMemory({
                        vendorName: d.vendorName,
                        phone: d.phone,
                        category: d.category,
                        city: cityName,
                        role: d.role,
                        source: "seed",
                        notes: d.notes,
                    });
                    seeded += 1;
                } catch (err: any) {
                    logger.warn(`[IssueAIService] seed default ${d.vendorName}/${cityName}: ${err?.message}`);
                }
            }
        }
        return seeded;
    }

    private rankContacts(
        issue: Issue,
        context: Awaited<ReturnType<IssueAIService["buildContextPack"]>>,
        ticketLane?: IrTicketLane
    ): IrRecommendedContact[] {
        const out: IrRecommendedContact[] = [];
        const category = String(issue.category || "").toLowerCase();
        const desc = `${issue.issue_description || ""} ${issue.ai_short_title || ""}`.toLowerCase();
        const stayStage = context.issue.stayStage;
        const lane = ticketLane || this.classifyTicketLane(issue);

        const push = (c: Omit<IrRecommendedContact, "rank" | "deepLinks">) => {
            if (!this.isUsablePersonName(c.name) && c.source !== "assignee") return;
            const phone = c.phone ? this.sanitizePhone(c.phone) : null;
            const email = c.email ? String(c.email).trim() : null;
            // Vendor-like rows without any usable reachability are noise.
            if (
                (c.source === "contact" || c.source === "poc" || c.source === "memory") &&
                !phone &&
                !email
            ) {
                return;
            }
            out.push({
                ...c,
                phone,
                email,
                rank: 0,
                deepLinks: {
                    call: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null,
                    sms: phone ? `sms:${phone.replace(/[^\d+]/g, "")}` : null,
                    mailto: email ? `mailto:${email}` : null,
                },
            });
        };

        const guestPhone = context.reservation?.phone || issue.guest_contact_number || null;
        const guestEmail = context.reservation?.email || null;
        const guestName = context.reservation?.guestName || issue.guest_name || "Guest";
        if ((guestPhone || guestEmail || guestName) && this.isUsablePersonName(guestName)) {
            push({
                role: "Guest",
                name: String(guestName),
                phone: guestPhone,
                email: guestEmail,
                reason:
                    stayStage === "in_house"
                        ? "Guest is in-house — confirm impact and set expectations after vendor plan."
                        : "Guest contact for updates and access coordination.",
                contactId: null,
                source: "guest",
            });
        }

        if (context.listing && ("ownerPhone" in context.listing || "ownerEmail" in context.listing)) {
            const ownerName = (context.listing as any).ownerName || "Owner";
            const ownerPhone = (context.listing as any).ownerPhone || null;
            const ownerEmail = (context.listing as any).ownerEmail || null;
            if (ownerPhone || ownerEmail) {
                push({
                    role: "Owner / PM",
                    name: String(ownerName),
                    phone: ownerPhone,
                    email: ownerEmail,
                    reason: "Property owner/PM — notify for approvals, access, or recurring preventable issues.",
                    contactId: null,
                    source: "owner",
                });
            }
        }

        const contacts = (context.contacts || []) as Contact[];
        const scored = contacts.map((c) => {
            const role = String(c.role || "").toLowerCase();
            const name = String(c.name || "");
            let score = 1;
            const reasons: string[] = [];

            if (role.includes("clean") || name.toLowerCase().includes("clean") || /^ana$|^diana$/i.test(name.trim())) {
                if (
                    lane.isEarlyCheckinAsk ||
                    lane.isLateCheckoutAsk ||
                    lane.isReservationChange ||
                    category.includes("clean") ||
                    desc.includes("clean") ||
                    desc.includes("mess")
                ) {
                    score += lane.isReservationChange || lane.isEarlyCheckinAsk || lane.isLateCheckoutAsk ? 14 : 8;
                    reasons.push(
                        lane.isEarlyCheckinAsk || lane.isLateCheckoutAsk
                            ? "Cleaner — confirm turnover for early/late request"
                            : "Cleaner role matches property ops"
                    );
                } else {
                    score += 3;
                    reasons.push("Cleaner role matches property ops");
                }
            }
            if (
                (lane.needsVendorDispatch || /maint|handy|repair|broken|hvac/.test(desc + category)) &&
                (role.includes("maint") || role.includes("handy") || /miguel|rodolfo/i.test(name))
            ) {
                score += 8;
                reasons.push("Portfolio maintenance/handyman contact");
            }
            if (role.includes("plumb") || category.includes("plumb") || desc.includes("leak") || desc.includes("toilet") || desc.includes("sink")) {
                if (role.includes("plumb") || /plumb|pipe|drain/i.test(name)) {
                    score += 10;
                    reasons.push("Plumbing-related issue");
                }
            }
            if (
                role.includes("hvac") ||
                role.includes("hvac") ||
                category.includes("hvac") ||
                desc.includes("ac") ||
                desc.includes("a/c") ||
                desc.includes("heat") ||
                desc.includes("thermostat")
            ) {
                if (role.includes("hvac") || /hvac|air|heat/i.test(name + role)) {
                    score += 10;
                    reasons.push("HVAC-related issue");
                }
            }
            if (desc.includes("lock") || desc.includes("code") || desc.includes("key") || desc.includes("entry")) {
                if (role.includes("lock") || /lock|access|smart/i.test(name + role)) {
                    score += 10;
                    reasons.push("Access/lockout signals");
                }
            }
            if (category.includes("pest") && (role.includes("pest") || /pest|extermin/i.test(name + role))) {
                score += 10;
                reasons.push("Pest control category");
            }
            if (category.includes("pool") && (role.includes("pool") || /pool|spa/i.test(name + role))) {
                score += 10;
                reasons.push("Pool/spa category");
            }
            if (role.includes("vendor") || role.includes("contractor") || role.includes("maintenance")) {
                score += 2;
                reasons.push("General vendor/maintenance contact");
            }
            if (String(issue.final_contractor_name || "").trim() && name.trim().toLowerCase() === String(issue.final_contractor_name).trim().toLowerCase()) {
                score += 12;
                reasons.push("Current ticket POC");
            }
            if (!c.contact && !c.email) score -= 5;

            return { c, score, reason: reasons[0] || "Listing contact" };
        });

        scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .forEach(({ c, reason }) => {
                push({
                    role: c.role || "Contact",
                    name: c.name,
                    phone: c.contact || null,
                    email: c.email || null,
                    reason,
                    contactId: c.id,
                    source: String(issue.final_contractor_name || "").trim().toLowerCase() === String(c.name || "").trim().toLowerCase()
                        ? "poc"
                        : "contact",
                });
            });

        if (issue.assignee) {
            push({
                role: "Internal assignee",
                name: String(issue.assignee),
                phone: null,
                email: null,
                reason: "Currently assigned ticket owner on the IR/GR team.",
                contactId: null,
                source: "assignee",
            });
        }

        // Re-rank: early-CI → cleaner first; in-house lockout → vendor/lock before guest
        const lockout = /lock|code|key|entry|can't get in|cant get in/i.test(desc);
        out.forEach((c) => {
            let boost = 0;
            if (
                (lane.isEarlyCheckinAsk || lane.isLateCheckoutAsk || lane.isReservationChange) &&
                /clean/i.test(`${c.role} ${c.name}`)
            ) {
                boost += 25;
            }
            if (stayStage === "in_house" && lockout && (c.source === "contact" || c.source === "poc") && /lock|access|vendor|contractor/i.test(c.role + c.name)) {
                boost += 20;
            }
            if (stayStage === "in_house" && c.source === "guest") boost += 8;
            if (c.source === "poc") boost += 15;
            (c as any)._sort = boost;
        });
        out.sort((a, b) => Number((b as any)._sort || 0) - Number((a as any)._sort || 0));
        return out.map((c, i) => {
            delete (c as any)._sort;
            return { ...c, rank: i + 1 };
        });
    }

    private mergeContactHints(
        ranked: IrRecommendedContact[],
        hints: any
    ): IrRecommendedContact[] {
        if (!Array.isArray(hints) || !hints.length) return ranked;
        const byName = new Map(ranked.map((c) => [c.name.trim().toLowerCase(), c]));
        const boosted = [...ranked];
        for (const hint of hints) {
            const nameHint = String(hint?.nameHint || hint?.name || "").trim().toLowerCase();
            if (!nameHint) continue;
            const match = [...byName.entries()].find(([n]) => n.includes(nameHint) || nameHint.includes(n));
            if (match) {
                match[1].reason = String(hint?.reason || match[1].reason);
                // Move toward front
                const idx = boosted.indexOf(match[1]);
                if (idx > 0) {
                    boosted.splice(idx, 1);
                    boosted.unshift(match[1]);
                }
            }
        }
        return boosted.map((c, i) => ({ ...c, rank: i + 1 }));
    }

    private normalizePlaybook(
        raw: any,
        issue: Issue,
        ticketLane?: IrTicketLane,
        upsellGuidance?: IrUpsellGuidance[],
        specialRules?: IrSpecialRulesGuidance
    ): IrPlaybookStep[] {
        const lane = ticketLane || this.classifyTicketLane(issue);
        if (lane.isRefundOrCancel) {
            return [
                {
                    step: "1. Escalate to GR refund managers (Anj/Jade)",
                    ownerLane: "GR",
                    detail: "Assigned task + notification created; open Mitigation when checkout exists",
                },
                {
                    step: "2. Do not dispatch vendors or quote refund amounts",
                    ownerLane: "GR",
                    detail: "Managers own policy / Airbnb mediation / goodwill decisions",
                },
                {
                    step: "3. Send holding reply only if guest is waiting",
                    ownerLane: "guest",
                    detail: "Team is reviewing — no dollar promises",
                },
            ];
        }
        if (lane.isAccessIssue) {
            return [
                {
                    step: "1. Check listing KB / door-code SOP (Schlage last-4, etc.)",
                    ownerLane: "GR",
                    detail: (specialRules?.listingKnowledge || []).slice(0, 2).join(" · ") || "Never invent codes",
                },
                {
                    step: "2. Guide guest through entry steps from known procedure",
                    ownerLane: "guest",
                    detail: "Confirm keypad wake / code entry / lock battery symptoms",
                },
                {
                    step: "3. If still locked out — contact lock vendor or cleaner",
                    ownerLane: "ops",
                    detail: "Use portfolio/contacts phone; log ETA on ticket",
                },
            ];
        }
        if (lane.isSupplies) {
            return [
                {
                    step: "1. Contact listing cleaner about missing supplies",
                    ownerLane: "ops",
                    detail: "Not a 'supplies vendor' hunt — cleaner usually restocks",
                },
                {
                    step: "2. Confirm what is missing and delivery timing",
                    ownerLane: "IR",
                    detail: undefined,
                },
                {
                    step: "3. Update guest once restock is arranged",
                    ownerLane: "guest",
                    detail: undefined,
                },
            ];
        }
        // Canonical GR reservation-change order — do not trust model reordering.
        if (lane.isReservationChange || lane.isEarlyCheckinAsk || lane.isLateCheckoutAsk) {
            const relevant =
                (upsellGuidance || []).find((u) =>
                    lane.isLateCheckoutAsk && !lane.isEarlyCheckinAsk ? u.isLateCheckout : u.isEarlyCheckin
                ) || (upsellGuidance || [])[0];
            const handling =
                lane.isLateCheckoutAsk && !lane.isEarlyCheckinAsk
                    ? specialRules?.lateCheckoutHandling || "defer_to_team"
                    : specialRules?.earlyCheckinHandling || "defer_to_team";
            const feeDetail =
                relevant?.guestFee != null
                    ? `Upsells fee $${Number(relevant.guestFee).toFixed(2)}; SDTO ${relevant.sdto}; autoRespond ${relevant.autoRespond}`
                    : "Pull fee/SDTO from Upsells for this listing";
            const specialDetail = (specialRules?.summaryLines || []).slice(0, 3).join(" · ") || `handling=${handling}`;
            return [
                {
                    step: "1. Check special rules (listing KB / ops overrides / early-late handling)",
                    ownerLane: "GR",
                    detail: specialDetail,
                },
                {
                    step: "2. Check Upsells early/late fee and SDTO",
                    ownerLane: "GR",
                    detail: feeDetail,
                },
                {
                    step: specialRules?.isLaunchClient
                        ? "3. Launch client — confirm early/late with OWNER"
                        : "3. Confirm turnover with CLEANER (skip only if Upsells auto-declines)",
                    ownerLane: specialRules?.isLaunchClient ? "owner" : "ops",
                    detail: specialRules?.isLaunchClient
                        ? `Tags: ${specialRules.listingTags || "Launch"} — do not default to cleaner`
                        : "Never hunt a RESERVATION CHANGES vendor",
                },
                {
                    step: "4. Contact guest last — quote, decline, or team will confirm",
                    ownerLane: "GR",
                    detail: "No clock-time promise unless TEAM already confirmed",
                },
            ];
        }
        if (Array.isArray(raw) && raw.length) {
            return raw
                .map((item) => ({
                    step: String(item?.step || "").trim(),
                    ownerLane: this.normalizeLane(item?.ownerLane),
                    detail: String(item?.detail || "").trim() || undefined,
                }))
                .filter((s) => s.step)
                .slice(0, 8);
        }
        const checklist = this.parseJsonArray(issue.ai_checklist);
        if (checklist.length) {
            return checklist.slice(0, 6).map((step) => ({
                step,
                ownerLane: (lane.lane === "GR" ? "GR" : "IR") as IrPlaybookStep["ownerLane"],
                detail: undefined,
            }));
        }
        return [
            { step: "Confirm guest impact and stay stage", ownerLane: "GR" },
            { step: "Contact the top recommended vendor/cleaner", ownerLane: "IR" },
            { step: "Log ETA and next update on the ticket", ownerLane: "IR" },
            { step: "Update the guest once a plan exists", ownerLane: "GR" },
        ];
    }

    private normalizeLane(value: any): IrPlaybookStep["ownerLane"] {
        const v = String(value || "IR").toUpperCase();
        if (v === "GR" || v.includes("GUEST RELATION")) return "GR";
        if (v.includes("VENDOR") || v.includes("CONTRACT")) return "vendor";
        if (v.includes("OWNER") || v.includes("PM")) return "owner";
        if (v.includes("GUEST")) return "guest";
        if (v.includes("OPS")) return "ops";
        return "IR";
    }

    private normalizeSeverity(value: any, issue: Issue): string {
        const v = String(value || "").toLowerCase();
        if (["critical", "high", "medium", "low"].includes(v)) return v;
        const urgency = Number(issue.urgency);
        if (urgency >= 5) return "critical";
        if (urgency >= 4) return "high";
        if (urgency >= 3) return "medium";
        return "low";
    }

    private normalizeStringArray(value: any): string[] {
        if (!Array.isArray(value)) return [];
        return value.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 10);
    }

    private parseJsonArray(value: any): string[] {
        if (Array.isArray(value)) return value.map(String);
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    }

    private computeStayStage(reservationOrIssue: any): string {
        const arrival = reservationOrIssue?.arrivalDate || reservationOrIssue?.check_in_date;
        const departure = reservationOrIssue?.departureDate;
        if (!arrival) return "unknown";
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const a = new Date(arrival);
        a.setHours(0, 0, 0, 0);
        const d = departure ? new Date(departure) : null;
        if (d) d.setHours(0, 0, 0, 0);
        if (a > today) return "pre_stay";
        if (d && d <= today) return "post_stay";
        if (a <= today && (!d || d > today)) return "in_house";
        return "unknown";
    }

    private async loadRecentFeedback(listingId: number | null) {
        if (!listingId) return [];
        try {
            const rows = await this.feedbackRepo.find({
                where: { listingId },
                order: { createdAt: "DESC" },
                take: 12,
            });
            // Prefer corrected playbooks / downs so the model learns from edits.
            const scored = rows
                .filter((r) => r.feedbackText || r.correctedResponse || r.categories)
                .map((r) => ({
                    rating: r.rating,
                    categories: this.parseJsonArray(r.categories),
                    feedbackText: r.feedbackText,
                    correctedResponse: r.correctedResponse ? String(r.correctedResponse).slice(0, 600) : null,
                    _score:
                        (r.correctedResponse ? 5 : 0) +
                        (r.rating === "down" ? 3 : 0) +
                        (r.rating === "up" ? 1 : 0),
                }))
                .sort((a, b) => b._score - a._score)
                .slice(0, 6);
            return scored.map(({ _score, ...rest }) => rest);
        } catch {
            return [];
        }
    }

    private async toPayload(row: IssueAISuggestionEntity, issue?: Issue | null): Promise<IrSuggestionPayload> {
        const complex = this.parseComplexFields(row);
        const issueRow = issue || (await this.issueRepo.findOne({ where: { id: row.issueId } }));
        const similarIssues = issueRow ? await this.findSimilarIssues(issueRow) : [];
        const channels = issueRow ? await this.resolveChannels(issueRow) : {
            hasInboxThread: false,
            inboxThreadId: null,
            hasQuoThread: false,
            quoConversationId: null,
        };

        let city: string | null = null;
        const payloadListingId = this.parsePositiveInt(issueRow?.listing_id);
        if (payloadListingId) {
            const listing = await this.listingRepo.findOne({
                where: { id: payloadListingId },
                withDeleted: true,
            });
            city = await this.resolveListingCity(listing, issueRow);
        } else if (issueRow) {
            city = await this.resolveListingCity(null, issueRow);
        }
        const ticketLane = issueRow ? this.classifyTicketLane(issueRow) : null;
        if (city) {
            await this.ensurePortfolioCityDefaults(city).catch(() => undefined);
        }
        const portfolioVendors = await this.loadPortfolioVendors({
            city,
            category: issueRow?.category || null,
            ticketLane,
        });
        const recommendedContacts = this.finalizeRecommendedContacts(
            this.mergePortfolioVendorsIntoContacts(complex.recommendedContacts, portfolioVendors),
            city,
            ticketLane || {
                lane: "IR",
                needsVendorDispatch: true,
                isReservationChange: false,
                isEarlyCheckinAsk: false,
                isLateCheckoutAsk: false,
                isAccessIssue: false,
                isSupplies: false,
                isRefundOrCancel: false,
            }
        );
        let upsellGuidance: IrUpsellGuidance[] = [];
        let specialRules: IrSpecialRulesGuidance | undefined;
        if (issueRow && ticketLane && (ticketLane.isReservationChange || ticketLane.lane === "GR")) {
            const context = await this.buildContextPack(issueRow);
            upsellGuidance = await this.loadUpsellGuidance(issueRow, context);
            specialRules = await this.loadSpecialRulesGuidance(issueRow, context, ticketLane);
        }
        const clarifyingQuestions = issueRow
            ? this.buildClarifyingQuestions(
                  issueRow,
                  recommendedContacts,
                  portfolioVendors,
                  ticketLane || undefined,
                  upsellGuidance,
                  specialRules
              )
            : [];

        return {
            id: row.id,
            issueId: row.issueId,
            summary: row.summary,
            severity: row.severity,
            primaryAction: row.primaryAction,
            playbook: complex.playbook,
            recommendedContacts,
            draftGuestMessage: row.draftGuestMessage,
            draftInternalNote: row.draftInternalNote,
            draftVendorMessage: row.draftVendorMessage,
            warnings: this.parseJsonArray(row.warningsJson),
            confidence: row.confidence != null ? Number(row.confidence) : null,
            modelName: row.modelName,
            promptVersion: row.promptVersion,
            status: row.status,
            generatedAt: row.generatedAt ? new Date(row.generatedAt).toISOString() : new Date().toISOString(),
            aiShortTitle: issueRow?.ai_short_title || null,
            aiChecklist: issueRow ? this.parseJsonArray(issueRow.ai_checklist) : [],
            similarIssues,
            portfolioVendors,
            clarifyingQuestions,
            channels,
        };
    }

    // -------------------------------------------------------------------------
    // Portfolio vendor memory
    // -------------------------------------------------------------------------

    private normalizeVendorKey(name: string): string {
        return String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private async loadPortfolioVendors(opts: {
        city?: string | null;
        category?: string | null;
        ticketLane?: IrTicketLane | null;
    }): Promise<IrPortfolioVendor[]> {
        const city = String(opts.city || "").trim();
        const category = String(opts.category || "").trim();
        const cities = this.regionCitiesFor(city);
        if (!cities.length && !category) return [];
        const lane = opts.ticketLane;
        const roleNeedles: string[] = [];
        const categoryNeedles: string[] = [];

        if (lane?.isSupplies) {
            roleNeedles.push("clean");
            categoryNeedles.push("CLEANLINESS", "SUPPLIES");
        } else if (lane?.isAccessIssue) {
            roleNeedles.push("lock", "maint", "handy", "clean");
            categoryNeedles.push("PROPERTY ACCESS", "MAINTENANCE");
        } else if (
            lane?.isReservationChange ||
            lane?.isEarlyCheckinAsk ||
            lane?.isLateCheckoutAsk ||
            (lane?.lane === "GR" && !lane?.isRefundOrCancel)
        ) {
            // GR / early-late: prefer cleaners (+ maintenance for turnover), never "RESERVATION CHANGES" vendors.
            roleNeedles.push("clean", "maint", "handy");
            categoryNeedles.push("CLEANLINESS", "MAINTENANCE");
        } else if (category && !lane?.isRefundOrCancel) {
            categoryNeedles.push(category);
            if (/clean/i.test(category)) roleNeedles.push("clean");
            if (/maint|hvac/i.test(category)) roleNeedles.push("maint", "handy");
            if (/pest/i.test(category)) roleNeedles.push("pest");
            if (/pool/i.test(category)) roleNeedles.push("pool");
        }

        // Never return cross-market vendors when city is unknown — better empty than wrong.
        if (!cities.length) return [];

        try {
            const qb = this.vendorMemoryRepo
                .createQueryBuilder("v")
                .andWhere("LOWER(TRIM(v.vendorName)) NOT IN (:...badNames)", { badNames: ["null", "undefined", ""] })
                .andWhere("v.phone IS NOT NULL AND TRIM(v.phone) <> ''")
                .andWhere(
                    "LOWER(TRIM(v.city)) IN (:...cities)",
                    { cities: cities.map((c) => c.toLowerCase()) }
                )
                .orderBy("v.useCount", "DESC")
                .addOrderBy("v.lastUsedAt", "DESC")
                .take(12);
            if (categoryNeedles.length || roleNeedles.length) {
                const parts: string[] = [];
                const params: Record<string, any> = {};
                categoryNeedles.forEach((c, i) => {
                    parts.push(`LOWER(TRIM(v.category)) = LOWER(:cat${i})`);
                    params[`cat${i}`] = c;
                });
                roleNeedles.forEach((r, i) => {
                    parts.push(`LOWER(COALESCE(v.role,'')) LIKE :role${i}`);
                    parts.push(`LOWER(v.vendorName) LIKE :rname${i}`);
                    params[`role${i}`] = `%${r}%`;
                    params[`rname${i}`] = `%${r}%`;
                });
                qb.andWhere(`(${parts.join(" OR ")})`, params);
            }
            const rows = await qb.getMany();
            return rows
                .filter((r) => r.vendorName && !/^null$/i.test(r.vendorName))
                .filter((r) => r.phone && !this.isBogusPhone(r.phone))
                .map((r) => ({
                    id: r.id,
                    name: r.vendorName,
                    phone: this.sanitizePhone(r.phone) || r.phone,
                    email: r.email,
                    category: r.category,
                    city: r.city,
                    role: r.role,
                    useCount: r.useCount,
                    reason: [
                        r.city ? `${r.city}` : null,
                        r.category || r.role || null,
                        r.source === "seed" ? "portfolio default" : null,
                        r.useCount > 1 ? `used ${r.useCount}×` : "from portfolio memory",
                    ]
                        .filter(Boolean)
                        .join(" · "),
                }));
        } catch (err: any) {
            // Table may not exist yet before migration runs.
            logger.warn(`[IssueAIService] loadPortfolioVendors skipped: ${err?.message}`);
            return [];
        }
    }

    private mergePortfolioVendorsIntoContacts(
        contacts: IrRecommendedContact[],
        vendors: IrPortfolioVendor[]
    ): IrRecommendedContact[] {
        const out = [...contacts];
        const seen = new Set(out.map((c) => this.normalizeVendorKey(c.name)));
        for (const v of vendors) {
            const key = this.normalizeVendorKey(v.name);
            if (!key || seen.has(key)) {
                // Enrich phone/email on existing match when missing.
                const existing = out.find((c) => this.normalizeVendorKey(c.name) === key);
                if (existing) {
                    if (!existing.phone && v.phone) existing.phone = v.phone;
                    if (!existing.email && v.email) existing.email = v.email;
                    if (existing.source !== "poc") existing.source = existing.source === "contact" ? "contact" : "memory";
                    existing.reason = existing.reason || v.reason;
                }
                continue;
            }
            seen.add(key);
            const phone = v.phone ? String(v.phone).trim() : null;
            const email = v.email ? String(v.email).trim() : null;
            out.unshift({
                rank: 0,
                role: v.role || v.category || "Vendor",
                name: v.name,
                phone,
                email,
                reason: `Portfolio memory: ${v.reason}`,
                contactId: null,
                source: "memory",
                deepLinks: {
                    call: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null,
                    sms: phone ? `sms:${phone.replace(/[^\d+]/g, "")}` : null,
                    mailto: email ? `mailto:${email}` : null,
                },
            });
        }
        return out.map((c, i) => ({ ...c, rank: i + 1 }));
    }

    private buildClarifyingQuestions(
        issue: Issue,
        contacts: IrRecommendedContact[],
        portfolioVendors: IrPortfolioVendor[],
        ticketLane?: IrTicketLane,
        upsellGuidance?: IrUpsellGuidance[],
        specialRules?: IrSpecialRulesGuidance
    ): IrClarifyingQuestion[] {
        const qs: IrClarifyingQuestion[] = [];
        const lane = ticketLane || this.classifyTicketLane(issue);
        const vendorLike = contacts.filter(
            (c) => c.source === "contact" || c.source === "poc" || c.source === "memory"
        );
        const withPhone = vendorLike.filter((c) => !!c.phone);
        const cleaners = withPhone.filter((c) => /clean/i.test(`${c.role} ${c.name} ${c.reason}`));
        const category = String(issue.category || "vendor").trim() || "vendor";

        if (lane.isRefundOrCancel) {
            qs.push({
                id: "refund_manager_escalation",
                kind: "general",
                question:
                    "Refund/cancellation routed to GR managers (Anj/Jade) via task + notification. Confirm any goodwill/Airbnb mediation decision with them — do not dispatch vendors.",
            });
            return this.dedupeQuestions(qs);
        }

        if (lane.isAccessIssue) {
            if (!(specialRules?.listingKnowledge || []).length) {
                qs.push({
                    id: "access_sop_missing",
                    kind: "general",
                    question:
                        "No door-code SOP found in listing KB. Confirm the property procedure (e.g. Schlage last 4 of guest phone) before sending a code.",
                });
            }
            return this.dedupeQuestions(qs);
        }

        if (lane.isSupplies) {
            qs.push({
                id: "supplies_cleaner",
                kind: cleaners.length ? "vendor_confirm" : "vendor_missing",
                question: cleaners.length
                    ? `Supplies restock: contact cleaner ${cleaners[0].name}${cleaners[0].phone ? ` (${cleaners[0].phone})` : ""}?`
                    : "Who is the cleaner (or supplies orderer) for this listing to restock?",
            });
            return this.dedupeQuestions(qs);
        }

        // Early-CI / reservation changes: never ask for a category-named vendor.
        if (lane.isReservationChange || lane.isEarlyCheckinAsk || lane.isLateCheckoutAsk) {
            const relevant = (upsellGuidance || []).find((u) =>
                lane.isLateCheckoutAsk && !lane.isEarlyCheckinAsk ? u.isLateCheckout : u.isEarlyCheckin || u.isLateCheckout
            );
            const quarantined = (specialRules?.opsOverrides || []).some(
                (o) => o.status === "quarantined" && /early_checkin|late_checkout/i.test(o.field)
            );
            if (quarantined) {
                qs.push({
                    id: "special_rule_quarantine",
                    kind: "general",
                    question:
                        "Special rules quarantine an early/late fee for this listing. Confirm the correct fee/policy with ops before contacting the guest.",
                });
            } else if (!relevant) {
                qs.push({
                    id: "upsell_missing",
                    kind: "general",
                    question:
                        "No early/late upsell fee found after special rules. Confirm the fee in Upsells (or owner policy) before quoting the guest.",
                });
            } else if (relevant?.autoRespond === "deny") {
                // Auto-decline — no turnover contact needed.
            } else if (specialRules?.isLaunchClient) {
                const owner = contacts.find((c) => c.source === "owner");
                qs.push({
                    id: "launch_owner_confirm",
                    kind: "general",
                    question: owner?.phone
                        ? `Launch/10% client: confirm early/late with owner ${owner.name} at ${owner.phone} before promising the guest.`
                        : "Launch/10% client: confirm early/late with the property owner (owner phone missing on listing).",
                });
            } else {
                qs.push({
                    id: "turnover_confirm",
                    kind: "general",
                    question: cleaners.length
                        ? `After special rules + Upsells: confirm turnover with cleaner ${cleaners[0].name}${cleaners[0].phone ? ` (${cleaners[0].phone})` : ""} before promising ${relevant?.title || "early/late"}.`
                        : `After special rules + Upsells: who is the cleaner to confirm turnover for this early/late request?`,
                });
            }
            return this.dedupeQuestions(qs);
        }

        // Other GR (comms, payments, etc.) — no vendor hunt.
        if (lane.lane === "GR" || !lane.needsVendorDispatch) {
            return this.dedupeQuestions(qs);
        }

        if (!withPhone.length && !portfolioVendors.length) {
            qs.push({
                id: "vendor_missing",
                kind: "vendor_missing",
                question: `No ${category} vendor is stored for this listing/city. Who do we use, and what is their phone number?`,
            });
        } else if (!withPhone.length && portfolioVendors.length) {
            const names = portfolioVendors
                .slice(0, 3)
                .map((v) => (v.phone ? `${v.name} (${v.phone})` : v.name))
                .join(", ");
            qs.push({
                id: "vendor_confirm",
                kind: "vendor_confirm",
                question: `Portfolio memory suggests: ${names}. Confirm which vendor to use, or teach a better name + number.`,
            });
        } else if (withPhone.length && !withPhone.some((c) => c.source === "contact" || c.source === "poc")) {
            qs.push({
                id: "vendor_confirm",
                kind: "vendor_confirm",
                question: `Using portfolio memory for ${withPhone[0].name}. Is this the right ${category} vendor/number for this ticket?`,
            });
        }
        return this.dedupeQuestions(qs);
    }

    private dedupeQuestions(items: IrClarifyingQuestion[]): IrClarifyingQuestion[] {
        const seen = new Set<string>();
        const out: IrClarifyingQuestion[] = [];
        for (const q of items) {
            const key = String(q.question || "")
                .toLowerCase()
                .replace(/\s+/g, " ")
                .trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(q);
            if (out.length >= 4) break;
        }
        return out;
    }

    private extractVendorFromText(text: string): { name: string; phone: string | null; email: string | null } | null {
        const raw = String(text || "").trim();
        if (!raw) return null;
        const phoneMatch = raw.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
        const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        const phone = phoneMatch ? phoneMatch[0] : null;
        const email = emailMatch ? emailMatch[0] : null;
        let name = raw
            .replace(phone || "", " ")
            .replace(email || "", " ")
            .replace(/^(vendor|hvac|plumber|cleaner|poc|contractor)\s*[:=\-]/i, " ")
            .replace(/\b(phone|number|tel|email|is|called?)\b/gi, " ")
            .replace(/[^\w\s&.'/-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (name.length < 2 && !phone) return null;
        if (name.length < 2) name = phone || "Vendor";
        return { name: name.slice(0, 120), phone, email };
    }

    async upsertVendorMemory(input: {
        vendorName: string;
        phone?: string | null;
        email?: string | null;
        category?: string | null;
        city?: string | null;
        role?: string | null;
        source?: string;
        sourceIssueId?: number | null;
        notes?: string | null;
    }) {
        const vendorName = String(input.vendorName || "").trim();
        const normalizedName = this.normalizeVendorKey(vendorName);
        if (!normalizedName || !this.isUsablePersonName(vendorName)) {
            logger.info(`[IssueAIService] ignoring unusable vendor name: ${String(input.vendorName).slice(0, 40)}`);
            return null;
        }
        const city = String(input.city || "").trim() || null;
        const category = String(input.category || "").trim() || null;
        const phone = this.sanitizePhone(input.phone);
        if (input.phone && !phone) {
            logger.info(
                `[IssueAIService] ignoring bogus phone for ${vendorName}: ${String(input.phone).slice(0, 32)}`
            );
        }
        const source = input.source || "issue";
        // Never create empty shells from scrapes/issues — they become null-phone rank noise.
        if (!phone && !input.email && !["teach", "feedback", "seed"].includes(source)) {
            return null;
        }

        let row = await this.vendorMemoryRepo.findOne({
            where: {
                normalizedName,
                city: city as any,
                category: category as any,
            },
        });
        if (!row) {
            // Fallback match without strict null city/category uniqueness quirks.
            row = await this.vendorMemoryRepo
                .createQueryBuilder("v")
                .where("v.normalizedName = :normalizedName", { normalizedName })
                .andWhere(city ? "LOWER(TRIM(v.city)) = LOWER(:city)" : "v.city IS NULL", city ? { city } : {})
                .andWhere(category ? "LOWER(TRIM(v.category)) = LOWER(:category)" : "v.category IS NULL", category ? { category } : {})
                .getOne();
        }

        if (!row) {
            row = this.vendorMemoryRepo.create({
                vendorName,
                normalizedName,
                phone,
                email: input.email || null,
                category,
                city,
                role: input.role || null,
                useCount: 1,
                lastUsedAt: new Date(),
                source,
                sourceIssueId: input.sourceIssueId ?? null,
                notes: input.notes || null,
            });
        } else {
            row.vendorName = vendorName;
            if (phone) row.phone = phone;
            // Clear previously stored junk NPAs if we re-touch the row without a good phone.
            if (row.phone && this.isBogusPhone(row.phone)) row.phone = phone;
            if (input.email) row.email = input.email;
            if (input.role) row.role = input.role;
            if (input.notes) row.notes = input.notes;
            row.useCount = Number(row.useCount || 0) + 1;
            row.lastUsedAt = new Date();
            row.source = source || row.source;
            if (input.sourceIssueId) row.sourceIssueId = input.sourceIssueId;
        }
        try {
            return await this.vendorMemoryRepo.save(row);
        } catch (err: any) {
            logger.warn(`[IssueAIService] upsertVendorMemory failed: ${err?.message}`);
            return null;
        }
    }

    /** Seed/refresh memory from completed issues + contacts in a city. */
    async hydrateVendorMemoryForCity(city: string | null, category: string | null) {
        const cityKey = String(city || "").trim();
        if (!cityKey) return { fromIssues: 0, fromContacts: 0 };
        let fromIssues = 0;
        let fromContacts = 0;

        try {
            const issueRows: any[] = await appDatabase.query(
                `SELECT i.id, i.final_contractor_name AS name, i.category
                 FROM issues i
                 INNER JOIN listing_info l ON l.id = CAST(NULLIF(TRIM(i.listing_id), '') AS UNSIGNED)
                 WHERE i.deleted_at IS NULL
                   AND i.status = 'Completed'
                   AND i.final_contractor_name IS NOT NULL
                   AND TRIM(i.final_contractor_name) <> ''
                   AND (
                     LOWER(TRIM(l.city)) = LOWER(?)
                     OR LOWER(l.address) LIKE LOWER(CONCAT('%, ', ?, ', %'))
                   )
                   ${category ? "AND i.category = ?" : ""}
                 ORDER BY i.id DESC
                 LIMIT 80`,
                category ? [cityKey, cityKey, category] : [cityKey, cityKey]
            );
            for (const r of issueRows || []) {
                await this.upsertVendorMemory({
                    vendorName: String(r.name),
                    category: r.category || category || null,
                    city: cityKey,
                    role: r.category || null,
                    source: "issue",
                    sourceIssueId: Number(r.id) || null,
                });
                fromIssues += 1;
            }
        } catch (err: any) {
            logger.warn(`[IssueAIService] hydrate issues skipped: ${err?.message}`);
        }

        try {
            const contactRows: any[] = await appDatabase.query(
                `SELECT c.id, c.name, c.contact AS phone, c.email, c.role, l.city
                 FROM contact c
                 INNER JOIN listing_info l ON l.id = CAST(c.listingId AS UNSIGNED)
                 WHERE c.deletedAt IS NULL
                   AND LOWER(TRIM(l.city)) = LOWER(?)
                   AND (
                     (? IS NULL OR LOWER(COALESCE(c.role,'')) LIKE CONCAT('%', LOWER(?), '%')
                        OR LOWER(COALESCE(c.name,'')) LIKE CONCAT('%', LOWER(?), '%'))
                   )
                 ORDER BY c.id DESC
                 LIMIT 80`,
                [cityKey, category, category || "", category || ""]
            );
            for (const r of contactRows || []) {
                await this.upsertVendorMemory({
                    vendorName: String(r.name),
                    phone: r.phone || null,
                    email: r.email || null,
                    category: category || r.role || null,
                    city: cityKey,
                    role: r.role || null,
                    source: "contact",
                });
                fromContacts += 1;
            }
        } catch (err: any) {
            logger.warn(`[IssueAIService] hydrate contacts skipped: ${err?.message}`);
        }

        return { fromIssues, fromContacts };
    }

    private async resolveChannels(issue: Issue): Promise<NonNullable<IrSuggestionPayload["channels"]>> {
        const reservationId = Number(issue.reservation_id);
        let inboxThreadId: number | null = null;
        let quoConversationId: string | null = null;
        if (Number.isFinite(reservationId) && reservationId > 0) {
            const conv = await this.conversationRepo.findOne({
                where: { reservationId },
                order: { lastMessageAt: "DESC" },
            });
            if (conv?.threadId) inboxThreadId = Number(conv.threadId);
            try {
                const { QuoInboxService } = require("./QuoInboxService");
                const quoConvs = await new QuoInboxService().listConversationsForReservation(reservationId);
                if (quoConvs?.[0]?.conversationId) quoConversationId = String(quoConvs[0].conversationId);
            } catch {
                /* optional */
            }
        }
        return {
            hasInboxThread: inboxThreadId != null,
            inboxThreadId,
            hasQuoThread: !!quoConversationId,
            quoConversationId,
        };
    }

    // -------------------------------------------------------------------------
    // Phase 2 — human-gated execute helpers
    // -------------------------------------------------------------------------

    async sendGuestDraft(issueId: number, body: string, user: any) {
        const text = String(body || "").trim();
        if (!text) throw CustomErrorHandler.validationError("Message body is required");
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);
        const reservationId = Number(issue.reservation_id);
        if (!Number.isFinite(reservationId) || reservationId <= 0) {
            throw CustomErrorHandler.validationError("Issue has no linked reservation for Inbox send");
        }
        const conv = await this.conversationRepo.findOne({
            where: { reservationId },
            order: { lastMessageAt: "DESC" },
        });
        if (!conv?.threadId) {
            throw CustomErrorHandler.notFound("No Inbox thread found for this reservation");
        }
        const { InboxService } = require("./InboxService");
        const saved = await new InboxService().sendReply(Number(conv.threadId), text, user);
        await this.logSystemUpdate(
            issue,
            `IR Copilot: guest message sent via Inbox (thread ${conv.threadId}).\n\n${text.slice(0, 1500)}`,
            user?.id || user?.secureStayUserId || "system"
        );
        return { sent: true, channel: "inbox", threadId: Number(conv.threadId), messageId: saved?.id ?? null };
    }

    async sendSmsDraft(
        issueId: number,
        body: string,
        opts: { phone?: string | null; user?: any; target?: "guest" | "vendor" } = {}
    ) {
        const text = String(body || "").trim();
        if (!text) throw CustomErrorHandler.validationError("Message body is required");
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);
        const reservationId = Number(issue.reservation_id);
        const { QuoInboxService } = require("./QuoInboxService");
        const quo = new QuoInboxService();

        if (Number.isFinite(reservationId) && reservationId > 0 && (opts.target || "guest") === "guest") {
            const quoConvs = await quo.listConversationsForReservation(reservationId);
            const conv = quoConvs?.[0];
            if (conv?.conversationId) {
                const senderName =
                    [userFirst(opts.user), userLast(opts.user)].filter(Boolean).join(" ") ||
                    opts.user?.email ||
                    "IR Copilot";
                const sentByUserId = Number(opts.user?.secureStayUserId ?? opts.user?.id) || null;
                const msg = await quo.sendReply(String(conv.conversationId), text, senderName, sentByUserId);
                await this.logSystemUpdate(
                    issue,
                    `IR Copilot: guest SMS sent via Quo.\n\n${text.slice(0, 1500)}`,
                    opts.user?.id || "system"
                );
                return {
                    sent: true,
                    channel: "quo",
                    conversationId: String(conv.conversationId),
                    messageId: msg?.id ?? null,
                };
            }
        }

        const phone =
            String(opts.phone || "").trim() ||
            String(issue.guest_contact_number || "").trim() ||
            null;
        if (phone) {
            const digits = phone.replace(/[^\d+]/g, "");
            return {
                sent: false,
                channel: "deep_link",
                deepLink: `sms:${digits}`,
                phone,
                message: "No Quo thread for this reservation — open the SMS deep-link or attach a Quo conversation first.",
            };
        }
        throw CustomErrorHandler.notFound("No Quo thread or phone number available for SMS");
    }

    async logInternalNote(issueId: number, note: string, userId: string) {
        const text = String(note || "").trim();
        if (!text) throw CustomErrorHandler.validationError("Note is required");
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);
        const { IssuesService } = require("./IssuesService");
        const update = await new IssuesService().createIssueUpdates(
            { issueId, updates: text, source: "securestay" },
            userId || "system"
        );
        return { logged: true, update };
    }

    async scheduleFollowUp(
        issueId: number,
        opts: { hours?: number; nextUpdateDate?: string | null; note?: string | null; userId?: string }
    ) {
        const issue = await this.issueRepo.findOne({ where: { id: issueId } });
        if (!issue) throw CustomErrorHandler.notFound(`Issue ${issueId} not found`);
        const { format } = require("date-fns");
        let nextDate = String(opts.nextUpdateDate || "").trim();
        if (!nextDate) {
            const hours = Math.max(1, Math.min(168, Number(opts.hours) || 2));
            const d = new Date(Date.now() + hours * 60 * 60 * 1000);
            nextDate = format(d, "yyyy-MM-dd");
        }
        issue.nextUpdateDate = nextDate as any;
        await this.issueRepo.save(issue);
        const note =
            String(opts.note || "").trim() ||
            `IR Copilot: follow-up scheduled for ${nextDate}.`;
        await this.logSystemUpdate(issue, note, opts.userId || "system");
        return { scheduled: true, nextUpdateDate: nextDate };
    }

    private async logSystemUpdate(issue: Issue, text: string, userId: string) {
        try {
            const { IssuesService } = require("./IssuesService");
            await new IssuesService().createIssueUpdates(
                { issueId: issue.id, updates: text, source: "system" },
                userId || "system"
            );
        } catch (err: any) {
            logger.warn(`[IssueAIService] failed to log update on issue ${issue.id}: ${err?.message}`);
        }
    }

    // -------------------------------------------------------------------------
    // Phase 3 — opt-in automation
    // -------------------------------------------------------------------------

    async onIssueCreated(issue: Issue, userId?: string) {
        try {
            await this.maybeAutoAssign(issue);
        } catch (err: any) {
            logger.warn(`[IssueAIService] auto-assign failed for #${issue.id}: ${err?.message}`);
        }
        try {
            await this.maybeAutoAck(issue, userId);
        } catch (err: any) {
            logger.warn(`[IssueAIService] auto-ack failed for #${issue.id}: ${err?.message}`);
        }
    }

    private async loadIrSettings() {
        const { AIMessagingSettingsService } = require("./AIMessagingSettingsService");
        return new AIMessagingSettingsService().getGlobal();
    }

    private listingAllowedForAutoAck(settings: any, listingId: number | null): boolean {
        const raw = String(settings?.irAutoAckListingIds || "").trim();
        if (!raw) return true;
        if (!listingId) return false;
        const ids = raw
            .split(/[\s,]+/)
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
        return ids.includes(listingId);
    }

    private isNarrowAutoAckPlaybook(issue: Issue): boolean {
        const hay = `${issue.category || ""} ${issue.issue_description || ""} ${issue.ai_short_title || ""}`.toLowerCase();
        return /lock|lockout|access code|can't get in|cant get in|door code|keypad|entry code/.test(hay);
    }

    async maybeAutoAssign(issue: Issue) {
        if (issue.assignee) return null;
        const settings = await this.loadIrSettings();
        if (Number(settings?.irAutoAssignEnabled || 0) === 0) return null;

        const { UsersService } = require("./UsersService");
        const dept = await new UsersService().fetchUserListByDepartment("guest-issues");
        const irDept =
            (dept?.priorityDepartments || []).find((d: any) =>
                String(d.name || "").toLowerCase().includes("issue resolution")
            ) || (dept?.priorityDepartments || [])[0];
        const candidates: Array<{ uid: string; name: string }> = (irDept?.users || []).filter(
            (u: any) => u?.uid
        );
        if (!candidates.length) return null;

        const openCounts: Array<{ assignee: string; cnt: string }> = await appDatabase.query(
            `SELECT assignee, COUNT(*) AS cnt
             FROM issues
             WHERE deleted_at IS NULL
               AND status <> 'Completed'
               AND assignee IS NOT NULL AND assignee <> ''
             GROUP BY assignee`
        );
        const countMap = new Map(openCounts.map((r) => [String(r.assignee), Number(r.cnt) || 0]));
        candidates.sort(
            (a, b) => (countMap.get(String(a.uid)) || 0) - (countMap.get(String(b.uid)) || 0)
        );
        const pick = candidates[0];
        issue.assignee = String(pick.uid);
        await this.issueRepo.save(issue);
        await this.logSystemUpdate(
            issue,
            `IR Copilot auto-assigned to ${pick.name || pick.uid} (least open IR load).`,
            "system"
        );
        return pick;
    }

    async maybeAutoAck(issue: Issue, userId?: string) {
        const settings = await this.loadIrSettings();
        if (Number(settings?.irAutoAckEnabled || 0) === 0) return null;
        const listingId = this.parsePositiveInt(issue.listing_id);
        if (!this.listingAllowedForAutoAck(settings, listingId)) return null;
        if (!this.isNarrowAutoAckPlaybook(issue)) return null;

        const stayStage = this.computeStayStage(issue);
        if (stayStage !== "in_house" && stayStage !== "unknown") return null;

        const reservationId = this.parsePositiveInt(issue.reservation_id);
        if (!reservationId) return null;
        const conv = await this.conversationRepo.findOne({
            where: { reservationId },
            order: { lastMessageAt: "DESC" },
        });
        if (!conv?.threadId) return null;

        const holding =
            "Hi — thanks for reaching out. We've received your access issue and our team is on it now. " +
            "We'll update you as soon as we have next steps. If you're outside and need immediate help, reply here.";

        const { InboxService } = require("./InboxService");
        const systemUser = { id: userId || "system", firstName: "IR", lastName: "Copilot" };
        await new InboxService().sendReply(Number(conv.threadId), holding, systemUser);
        await this.logSystemUpdate(
            issue,
            `IR Copilot auto-ack sent to guest (opt-in access/lockout playbook).\n\n${holding}`,
            userId || "system"
        );
        return { sent: true, threadId: Number(conv.threadId) };
    }

    /**
     * Stale in-house Guest Issues → Ops Radar style alert rows (called from sweepSLA).
     */
    async listStaleInHouseIssues(staleHours?: number): Promise<
        Array<{
            id: number;
            listingId: number | null;
            listingName: string | null;
            guestName: string | null;
            assignee: string | null;
            title: string;
            hoursStale: number;
            stayStage: string;
        }>
    > {
        const settings = await this.loadIrSettings().catch(() => null);
        const hours = Math.max(1, Math.min(48, Number(staleHours ?? settings?.irStaleHoursInHouse ?? 2)));
        const rows: any[] = await appDatabase.query(
            `SELECT i.id, i.listing_id AS listingId, i.listing_name AS listingName,
                    i.guest_name AS guestName, i.assignee, i.ai_short_title AS aiShortTitle,
                    i.issue_description AS description, i.check_in_date AS checkIn,
                    i.created_at AS createdAt,
                    (SELECT MAX(u.createdAt) FROM issues_updates u
                      WHERE u.issueId = i.id AND u.deletedAt IS NULL) AS lastUpdateAt,
                    r.arrivalDate, r.departureDate
             FROM issues i
             LEFT JOIN reservation_info r ON r.id = CAST(i.reservation_id AS UNSIGNED)
             WHERE i.deleted_at IS NULL
               AND i.status <> 'Completed'
               AND (
                 (r.arrivalDate IS NOT NULL AND r.arrivalDate <= CURDATE()
                   AND (r.departureDate IS NULL OR r.departureDate > CURDATE()))
                 OR (r.arrivalDate IS NULL AND i.check_in_date IS NOT NULL
                   AND i.check_in_date <= CURDATE())
               )
               AND COALESCE(
                     (SELECT MAX(u.createdAt) FROM issues_updates u
                       WHERE u.issueId = i.id AND u.deletedAt IS NULL),
                     i.created_at
                   ) <= DATE_SUB(NOW(), INTERVAL ? HOUR)
             ORDER BY COALESCE(
                     (SELECT MAX(u.createdAt) FROM issues_updates u
                       WHERE u.issueId = i.id AND u.deletedAt IS NULL),
                     i.created_at
                   ) ASC
             LIMIT 80`,
            [hours]
        );
        const now = Date.now();
        return (rows || []).map((r) => {
            const last = r.lastUpdateAt || r.createdAt;
            const hoursStale = Math.max(0, (now - new Date(last).getTime()) / 3600000);
            return {
                id: Number(r.id),
                listingId: r.listingId != null ? Number(r.listingId) : null,
                listingName: r.listingName || null,
                guestName: r.guestName || null,
                assignee: r.assignee || null,
                title: String(r.aiShortTitle || r.description || `Issue #${r.id}`).slice(0, 140),
                hoursStale: Math.round(hoursStale * 10) / 10,
                stayStage: "in_house",
            };
        });
    }

    private parseComplexFields(row: IssueAISuggestionEntity): {
        playbook: IrPlaybookStep[];
        recommendedContacts: IrRecommendedContact[];
    } {
        let playbook: IrPlaybookStep[] = [];
        let recommendedContacts: IrRecommendedContact[] = [];
        try {
            const p = row.playbookJson ? JSON.parse(row.playbookJson) : [];
            if (Array.isArray(p)) {
                playbook = p.map((item: any) => ({
                    step: String(item?.step || "").trim(),
                    ownerLane: this.normalizeLane(item?.ownerLane),
                    detail: item?.detail ? String(item.detail) : undefined,
                })).filter((s: IrPlaybookStep) => s.step);
            }
        } catch {
            playbook = [];
        }
        try {
            const c = row.recommendedContactsJson ? JSON.parse(row.recommendedContactsJson) : [];
            if (Array.isArray(c)) recommendedContacts = c as IrRecommendedContact[];
        } catch {
            recommendedContacts = [];
        }
        return { playbook, recommendedContacts };
    }
}

function userFirst(user: any): string {
    return String(user?.firstName || user?.given_name || "").trim();
}
function userLast(user: any): string {
    return String(user?.lastName || user?.family_name || "").trim();
}
