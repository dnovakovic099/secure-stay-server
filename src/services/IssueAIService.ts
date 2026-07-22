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

const PROMPT_VERSION = "ir-copilot-v1";
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
    source: "guest" | "owner" | "contact" | "assignee" | "poc";
    deepLinks?: { call?: string | null; sms?: string | null; mailto?: string | null };
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
    private openai: OpenAI | null = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

    async getLatestSuggestion(issueId: number): Promise<IrSuggestionPayload | null> {
        const row = await this.suggestionRepo.findOne({
            where: { issueId },
            order: { generatedAt: "DESC", id: "DESC" },
        });
        if (!row) return null;
        return this.toPayload(row);
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
                return this.toPayload(existing, issue);
            }
        }

        const context = await this.buildContextPack(issue);
        const heuristicContacts = this.rankContacts(issue, context);
        const recentFeedback = await this.loadRecentFeedback(Number(issue.listing_id) || null);

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
                                "contactHints (array of {role, nameHint, reason} — names must match provided contacts when possible),",
                                "draftGuestMessage, draftInternalNote, draftVendorMessage, warnings (string[]), confidence (0-100).",
                                "ownerLane must be one of: IR, GR, vendor, owner, guest, ops.",
                                "IR = Issue Resolution / maintenance lane; GR = Guest Relations lane.",
                                "Never invent access codes, refund amounts, vendor ETAs, or facts not in context.",
                                "Prefer calling vendors/cleaners before promising guest outcomes.",
                                "Keep drafts short, professional, and actionable. No auto-send — human will review.",
                                "If guest is in-house, prioritize safety/access/comfort and fast contact.",
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
                                recentMessages: context.recentMessages,
                                similarHints: context.similarHints,
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
        const recommendedContacts = this.mergeContactHints(heuristicContacts, modelOut?.contactHints);
        const warnings = this.normalizeStringArray(modelOut?.warnings);
        if (!context.reservation) warnings.push("No linked reservation — guest stay context may be incomplete.");
        if (!recommendedContacts.some((c) => c.phone || c.email)) {
            warnings.push("No usable phone/email on recommended contacts — ask ops to update the contact list.");
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
            primaryAction: String(modelOut?.primaryAction || playbook[0]?.step || "Review ticket and contact the top recommended person.").trim(),
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
        return this.toPayload(saved, issue);
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

        return saved;
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

        let similarHints: string[] = [];
        if (Number.isFinite(listingId) && issue.category) {
            try {
                const similar = await this.issueRepo.find({
                    where: {
                        listing_id: String(listingId),
                        category: issue.category,
                        status: "Completed",
                    },
                    order: { id: "DESC" },
                    take: 3,
                });
                similarHints = similar
                    .filter((s) => s.id !== issue.id)
                    .map((s) =>
                        [
                            s.ai_short_title || s.issue_description?.slice(0, 80),
                            s.resolution ? `IR note: ${String(s.resolution).slice(0, 120)}` : null,
                            s.final_contractor_name ? `POC: ${s.final_contractor_name}` : null,
                        ]
                            .filter(Boolean)
                            .join(" | ")
                    );
            } catch {
                /* optional */
            }
        }

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
                      ownerName: listing.ownerName,
                      ownerPhone: listing.ownerPhone,
                      ownerEmail: listing.ownerEmail,
                  }
                : { id: listingId || null, name: issue.listing_name },
            contacts,
            recentMessages,
            similarHints,
        };
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
                take: 5,
            });
            return rows
                .filter((r) => r.feedbackText || r.correctedResponse || r.categories)
                .map((r) => ({
                    rating: r.rating,
                    categories: this.parseJsonArray(r.categories),
                    feedbackText: r.feedbackText,
                    correctedResponse: r.correctedResponse ? String(r.correctedResponse).slice(0, 400) : null,
                }));
        } catch {
            return [];
        }
    }

    private toPayload(row: IssueAISuggestionEntity, issue?: Issue | null): IrSuggestionPayload {
        const complex = this.parseComplexFields(row);
        return {
            id: row.id,
            issueId: row.issueId,
            summary: row.summary,
            severity: row.severity,
            primaryAction: row.primaryAction,
            playbook: complex.playbook,
            recommendedContacts: complex.recommendedContacts,
            draftGuestMessage: row.draftGuestMessage,
            draftInternalNote: row.draftInternalNote,
            draftVendorMessage: row.draftVendorMessage,
            warnings: this.parseJsonArray(row.warningsJson),
            confidence: row.confidence != null ? Number(row.confidence) : null,
            modelName: row.modelName,
            promptVersion: row.promptVersion,
            status: row.status,
            generatedAt: row.generatedAt ? new Date(row.generatedAt).toISOString() : new Date().toISOString(),
            aiShortTitle: issue?.ai_short_title || null,
            aiChecklist: issue ? this.parseJsonArray(issue.ai_checklist) : [],
        };
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
