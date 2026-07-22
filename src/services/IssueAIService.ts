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

const PROMPT_VERSION = "ir-copilot-v2";
const MODEL = "gpt-4o-mini";

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
        // Best-effort: keep portfolio memory warm from recent completed tickets in this city.
        void this.hydrateVendorMemoryForCity(context.listing?.city || null, issue.category || null).catch(() => undefined);

        const portfolioVendors = await this.loadPortfolioVendors({
            city: (context.listing as any)?.city || null,
            category: issue.category || null,
        });
        const heuristicContacts = this.mergePortfolioVendorsIntoContacts(
            this.rankContacts(issue, context),
            portfolioVendors
        );
        const recentFeedback = await this.loadRecentFeedback(Number(issue.listing_id) || null);
        const clarifyingQuestions = this.buildClarifyingQuestions(issue, heuristicContacts, portfolioVendors);

        let modelOut: any = null;
        let rawResponse: string | null = null;

        if (this.openai) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: MODEL,
                    temperature: 0.2,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content: [
                                "You are the SecureStay Issue Resolution Copilot for guest property tickets.",
                                "Return ONLY valid JSON with keys:",
                                "summary (string), severity (critical|high|medium|low), primaryAction (string),",
                                "playbook (array of {step, ownerLane, detail}),",
                                "contactHints (array of {role, nameHint, reason} — names must match provided contacts/portfolioVendors when possible),",
                                "clarifyingQuestions (string[] — ask the human when vendor/phone/facts are missing; empty if not needed),",
                                "draftGuestMessage, draftInternalNote, draftVendorMessage, warnings (string[]), confidence (0-100).",
                                "ownerLane must be one of: IR, GR, vendor, owner, guest, ops.",
                                "IR = Issue Resolution / maintenance lane; GR = Guest Relations lane.",
                                "Never invent access codes, refund amounts, vendor ETAs, phones, or vendor names not in context.",
                                "If portfolioVendors or contacts include a matching vendor, primaryAction MUST name them and their phone when available.",
                                "If no vendor/phone is available, primaryAction should say we need the vendor identity/number, and clarifyingQuestions must ask for it.",
                                "Prefer calling vendors/cleaners before promising guest outcomes.",
                                "Keep drafts short, professional, and actionable. No auto-send — human will review.",
                                "If guest is in-house, prioritize safety/access/comfort and fast contact.",
                                "Treat recentTeamFeedback correctedResponse as preferred playbook/draft wording for this listing.",
                            ].join(" "),
                        },
                        {
                            role: "user",
                            content: JSON.stringify({
                                issue: context.issue,
                                updates: context.updates,
                                reservation: context.reservation,
                                listing: context.listing,
                                contacts: heuristicContacts,
                                portfolioVendors,
                                clarifyingQuestionsSeed: clarifyingQuestions,
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

        const playbook = this.normalizePlaybook(modelOut?.playbook, issue);
        let recommendedContacts = this.mergeContactHints(heuristicContacts, modelOut?.contactHints);
        recommendedContacts = this.mergePortfolioVendorsIntoContacts(recommendedContacts, portfolioVendors);
        const warnings = this.normalizeStringArray(modelOut?.warnings);
        if (!context.reservation) warnings.push("No linked reservation — guest stay context may be incomplete.");
        if (!recommendedContacts.some((c) => (c.source === "contact" || c.source === "poc" || c.source === "memory") && (c.phone || c.email))) {
            warnings.push("No usable vendor phone/email — ask the team who we use and teach IR Copilot.");
        }

        const topVendor = recommendedContacts.find(
            (c) => (c.source === "memory" || c.source === "poc" || c.source === "contact") && (c.phone || c.name)
        );
        let primaryAction = String(modelOut?.primaryAction || "").trim();
        if (topVendor?.name && topVendor.phone && !/^\d/.test(primaryAction) && !primaryAction.toLowerCase().includes(topVendor.name.toLowerCase().slice(0, 8))) {
            primaryAction = `Call ${topVendor.name} at ${topVendor.phone} about this ${issue.category || "issue"}.`;
        } else if (!primaryAction) {
            primaryAction = clarifyingQuestions[0]?.question
                || playbook[0]?.step
                || "Review ticket and contact the top recommended person.";
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
            listingId: Number(issue.listing_id) || null,
            reservationId: Number(issue.reservation_id) || null,
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
                const listing = Number(issue.listing_id)
                    ? await this.listingRepo.findOne({ where: { id: Number(issue.listing_id) } })
                    : null;
                await this.upsertVendorMemory({
                    vendorName: taught.name,
                    phone: taught.phone,
                    email: taught.email,
                    category: issue.category || null,
                    city: listing?.city || null,
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

        const listing = Number(issue.listing_id)
            ? await this.listingRepo.findOne({ where: { id: Number(issue.listing_id) } })
            : null;

        await this.upsertVendorMemory({
            vendorName: name,
            phone: input.phone ? String(input.phone).trim() : null,
            email: input.email ? String(input.email).trim() : null,
            category: issue.category || null,
            city: listing?.city || null,
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

        const listingId = Number(issue.listing_id);
        const listing = Number.isFinite(listingId)
            ? await this.listingRepo.findOne({ where: { id: listingId }, withDeleted: true })
            : null;

        const reservationId = Number(issue.reservation_id);
        const reservation = Number.isFinite(reservationId) && reservationId > 0
            ? await this.reservationRepo.findOne({ where: { id: reservationId } })
            : null;

        const contacts = Number.isFinite(listingId)
            ? await this.contactRepo.find({
                  where: { listingId: String(listingId) },
                  take: 80,
              })
            : [];

        let recentMessages: Array<{ at: string; direction: string; body: string }> = [];
        if (Number.isFinite(reservationId) && reservationId > 0) {
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
                      city: listing.city || null,
                      ownerName: listing.ownerName,
                      ownerPhone: listing.ownerPhone,
                      ownerEmail: listing.ownerEmail,
                  }
                : { id: listingId || null, name: issue.listing_name, city: null },
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
                ? await this.listingRepo.findOne({ where: { id: listingId } })
                : null;
            const city = String(listing?.city || "").trim();
            if (city) {
                const rows: any[] = await appDatabase.query(
                    `SELECT i.id, i.ai_short_title AS ai_short_title, i.issue_description AS issue_description,
                            i.resolution, i.final_contractor_name AS final_contractor_name, i.category
                     FROM issues i
                     INNER JOIN listing_info l ON l.id = CAST(i.listing_id AS UNSIGNED)
                     WHERE i.deleted_at IS NULL
                       AND i.status = 'Completed'
                       AND i.category = ?
                       AND LOWER(TRIM(l.city)) = LOWER(?)
                       AND i.id <> ?
                     ORDER BY i.id DESC
                     LIMIT 8`,
                    [issue.category, city, issue.id]
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

    private rankContacts(issue: Issue, context: Awaited<ReturnType<IssueAIService["buildContextPack"]>>): IrRecommendedContact[] {
        const out: IrRecommendedContact[] = [];
        const category = String(issue.category || "").toLowerCase();
        const desc = `${issue.issue_description || ""} ${issue.ai_short_title || ""}`.toLowerCase();
        const stayStage = context.issue.stayStage;

        const push = (c: Omit<IrRecommendedContact, "rank" | "deepLinks">) => {
            const phone = c.phone ? String(c.phone).trim() : null;
            const email = c.email ? String(c.email).trim() : null;
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
        if (guestPhone || guestEmail || guestName) {
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

            if (role.includes("clean") || name.toLowerCase().includes("clean")) {
                score += category.includes("clean") || desc.includes("clean") || desc.includes("mess") ? 8 : 3;
                reasons.push("Cleaner role matches property ops");
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

        // Re-rank: in-house lockout → vendor/lock before guest; otherwise guest high but after critical vendor
        const lockout = /lock|code|key|entry|can't get in|cant get in/i.test(desc);
        out.forEach((c) => {
            let boost = 0;
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

    private normalizePlaybook(raw: any, issue: Issue): IrPlaybookStep[] {
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
                ownerLane: "IR" as const,
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
        if (issueRow?.listing_id) {
            const listing = await this.listingRepo.findOne({ where: { id: Number(issueRow.listing_id) } });
            city = listing?.city || null;
        }
        const portfolioVendors = await this.loadPortfolioVendors({
            city,
            category: issueRow?.category || null,
        });
        const recommendedContacts = this.mergePortfolioVendorsIntoContacts(
            complex.recommendedContacts,
            portfolioVendors
        );
        const clarifyingQuestions = issueRow
            ? this.buildClarifyingQuestions(issueRow, recommendedContacts, portfolioVendors)
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
    }): Promise<IrPortfolioVendor[]> {
        const city = String(opts.city || "").trim();
        const category = String(opts.category || "").trim();
        if (!city && !category) return [];
        try {
            const qb = this.vendorMemoryRepo
                .createQueryBuilder("v")
                .orderBy("v.useCount", "DESC")
                .addOrderBy("v.lastUsedAt", "DESC")
                .take(8);
            if (city) qb.andWhere("LOWER(TRIM(v.city)) = LOWER(:city)", { city });
            if (category) {
                qb.andWhere(
                    "(LOWER(TRIM(v.category)) = LOWER(:category) OR LOWER(COALESCE(v.role,'')) LIKE :roleLike OR LOWER(v.vendorName) LIKE :nameLike)",
                    {
                        category,
                        roleLike: `%${category.toLowerCase()}%`,
                        nameLike: `%${category.toLowerCase()}%`,
                    }
                );
            }
            const rows = await qb.getMany();
            return rows.map((r) => ({
                id: r.id,
                name: r.vendorName,
                phone: r.phone,
                email: r.email,
                category: r.category,
                city: r.city,
                role: r.role,
                useCount: r.useCount,
                reason: [
                    r.city ? `${r.city}` : null,
                    r.category || r.role || null,
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
        portfolioVendors: IrPortfolioVendor[]
    ): IrClarifyingQuestion[] {
        const qs: IrClarifyingQuestion[] = [];
        const vendorLike = contacts.filter(
            (c) => c.source === "contact" || c.source === "poc" || c.source === "memory"
        );
        const withPhone = vendorLike.filter((c) => !!c.phone);
        const category = String(issue.category || "vendor").trim() || "vendor";

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
        return qs;
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
        if (!normalizedName) return null;
        const city = String(input.city || "").trim() || null;
        const category = String(input.category || "").trim() || null;

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
                phone: input.phone || null,
                email: input.email || null,
                category,
                city,
                role: input.role || null,
                useCount: 1,
                lastUsedAt: new Date(),
                source: input.source || "issue",
                sourceIssueId: input.sourceIssueId ?? null,
                notes: input.notes || null,
            });
        } else {
            row.vendorName = vendorName;
            if (input.phone) row.phone = input.phone;
            if (input.email) row.email = input.email;
            if (input.role) row.role = input.role;
            if (input.notes) row.notes = input.notes;
            row.useCount = Number(row.useCount || 0) + 1;
            row.lastUsedAt = new Date();
            row.source = input.source || row.source;
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
                 INNER JOIN listing_info l ON l.id = CAST(i.listing_id AS UNSIGNED)
                 WHERE i.deleted_at IS NULL
                   AND i.status = 'Completed'
                   AND i.final_contractor_name IS NOT NULL
                   AND TRIM(i.final_contractor_name) <> ''
                   AND LOWER(TRIM(l.city)) = LOWER(?)
                   ${category ? "AND i.category = ?" : ""}
                 ORDER BY i.id DESC
                 LIMIT 80`,
                category ? [cityKey, category] : [cityKey]
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
        const listingId = Number(issue.listing_id) || null;
        if (!this.listingAllowedForAutoAck(settings, listingId)) return null;
        if (!this.isNarrowAutoAckPlaybook(issue)) return null;

        const stayStage = this.computeStayStage(issue);
        if (stayStage !== "in_house" && stayStage !== "unknown") return null;

        const reservationId = Number(issue.reservation_id);
        if (!Number.isFinite(reservationId) || reservationId <= 0) return null;
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
