import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReviewService } from "./ReviewService";
import { GuestAnalysisService } from "./GuestAnalysisService";
import { GuestCommunicationService } from "./GuestCommunicationService";
import {
    ReviewReportChatMessage,
    ReviewReportDocument,
    ReviewReportEntity,
    ReviewReportFilters,
    ReviewReportSection,
    ReviewReportSectionKey,
    ReviewReportTemplateType,
    ReviewReportVersionEntity,
} from "../entity/ReviewReport";
import { GuestAnalysisEntity } from "../entity/GuestAnalysis";

type ReviewReportTemplateDefinition = {
    type: ReviewReportTemplateType;
    label: string;
    description: string;
    sections: Array<{ key: ReviewReportSectionKey; title: string }>;
};

type ReviewOutcome = {
    rating: number | null;
    hasReview: boolean;
    reviewText: string | null;
    reviewVisibility: string | null;
};

type ReservationReportContext = {
    reservationId: number;
    guestName: string | null;
    listingName: string | null;
    propertyType: string | null;
    serviceType: string | null;
    channelName: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    latestUpdate: string | null;
    resolutionNotes: string | null;
    updateHistory: string[];
    communications: Array<{
        source: string;
        direction: string;
        communicatedAt: string;
        content: string;
    }>;
    aiAnalysis: GuestAnalysisEntity | null;
    review: ReviewOutcome;
    negotiation: {
        classification: "success" | "failure" | "neutral";
        reason: string;
        meaningfulAction: boolean;
        evidence: string[];
    };
};

const REVIEW_REPORT_TEMPLATES: ReviewReportTemplateDefinition[] = [
    {
        type: "executive_weekly",
        label: "Executive Weekly",
        description: "Leadership-ready summary of weekly review performance, operational failures, negotiation outcomes, and next actions.",
        sections: [
            { key: "executive_summary", title: "Executive Summary" },
            { key: "review_performance", title: "Review Performance" },
            { key: "operational_failures", title: "Operational Failures" },
            { key: "negotiation_performance", title: "Negotiation Performance" },
            { key: "action_plan", title: "Action Plan" },
        ],
    },
    {
        type: "operations_deep_dive",
        label: "Operations Deep Dive",
        description: "Detailed operational analysis with failure patterns, category and department themes, and notable reservations.",
        sections: [
            { key: "executive_summary", title: "Executive Summary" },
            { key: "review_performance", title: "Review Performance" },
            { key: "operational_failures", title: "Operational Failures" },
            { key: "category_department_breakdown", title: "Category & Department Breakdown" },
            { key: "notable_reservations", title: "Notable Reservations" },
            { key: "action_plan", title: "Action Plan" },
        ],
    },
    {
        type: "negotiation_review",
        label: "Negotiation Review",
        description: "Focused coaching report on review prevention, negotiation effort, wins, misses, and follow-up opportunities.",
        sections: [
            { key: "executive_summary", title: "Executive Summary" },
            { key: "negotiation_performance", title: "Negotiation Performance" },
            { key: "operational_failures", title: "Operational Failures" },
            { key: "coaching_opportunities", title: "Coaching Opportunities" },
            { key: "action_plan", title: "Action Plan" },
        ],
    },
];

export class ReviewReportsService {
    private reportRepo = appDatabase.getRepository(ReviewReportEntity);
    private versionRepo = appDatabase.getRepository(ReviewReportVersionEntity);
    private reviewService = new ReviewService();
    private guestAnalysisService = new GuestAnalysisService();
    private guestCommunicationService = new GuestCommunicationService();
    private openai: OpenAI;
    private schemaReadyPromise: Promise<void> | null = null;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
    }

    listTemplates() {
        return REVIEW_REPORT_TEMPLATES;
    }

    async listReports() {
        await this.ensureSchemaReady();
        const reports = await this.reportRepo.find({ order: { updatedAt: "DESC" } });
        const reportIds = reports.map((report) => report.id);
        const versions = reportIds.length
            ? await this.versionRepo.find({ where: reportIds.map((reportId) => ({ reportId })), order: { versionNumber: "DESC" } })
            : [];
        const latestVersionByReport = new Map<string, ReviewReportVersionEntity>();
        versions.forEach((version) => {
            if (!latestVersionByReport.has(version.reportId)) {
                latestVersionByReport.set(version.reportId, version);
            }
        });

        return reports.map((report) => ({
            ...report,
            latestVersion: latestVersionByReport.get(report.id) || null,
        }));
    }

    async getReport(reportId: string) {
        await this.ensureSchemaReady();
        const report = await this.requireReport(reportId);
        const versions = await this.versionRepo.find({
            where: { reportId },
            order: { versionNumber: "DESC" },
        });
        const currentVersion = versions.find((version) => version.versionNumber === report.currentVersionNumber) || versions[0] || null;

        return {
            ...report,
            currentVersion,
            versions,
            templates: REVIEW_REPORT_TEMPLATES,
        };
    }

    async createReport(payload: {
        name?: string;
        templateType: ReviewReportTemplateType;
        filters: ReviewReportFilters;
    }, userId: string | null) {
        await this.ensureSchemaReady();
        const template = this.getTemplate(payload.templateType);
        const normalizedFilters = this.normalizeFilters(payload.filters);
        const generated = await this.generateDocument({
            template,
            filters: normalizedFilters,
            currentDocument: null,
            instruction: null,
            targetSectionKey: null,
            userId,
        });

        const report = this.reportRepo.create({
            id: uuidv4(),
            name: String(payload.name || `${template.label} — ${format(new Date(), "MMM d, yyyy h:mm a")}`),
            templateType: template.type,
            filters: normalizedFilters,
            chatHistory: generated.chatHistory,
            linkedAiThreadId: null,
            currentVersionNumber: 1,
            createdBy: userId,
            updatedBy: userId,
        });
        await this.reportRepo.save(report);

        const version = this.versionRepo.create({
            id: uuidv4(),
            reportId: report.id,
            versionNumber: 1,
            generationType: "generated",
            targetSectionKey: null,
            instruction: null,
            document: generated.document,
            createdBy: userId,
        });
        await this.versionRepo.save(version);

        return this.getReport(report.id);
    }

    async reviseReport(reportId: string, payload: {
        instruction: string;
        targetSectionKey?: ReviewReportSectionKey | null;
    }, userId: string | null) {
        await this.ensureSchemaReady();
        if (!String(payload.instruction || "").trim()) {
            throw new Error("Revision instruction is required");
        }
        const report = await this.requireReport(reportId);
        const currentVersion = await this.requireCurrentVersion(report);
        const template = this.getTemplate(report.templateType);
        const generated = await this.generateDocument({
            template,
            filters: this.normalizeFilters(report.filters),
            currentDocument: currentVersion.document,
            instruction: String(payload.instruction).trim(),
            targetSectionKey: payload.targetSectionKey || null,
            userId,
            existingChatHistory: report.chatHistory || [],
        });

        const nextVersionNumber = report.currentVersionNumber + 1;
        const version = this.versionRepo.create({
            id: uuidv4(),
            reportId: report.id,
            versionNumber: nextVersionNumber,
            generationType: "revised",
            targetSectionKey: payload.targetSectionKey || null,
            instruction: String(payload.instruction).trim(),
            document: generated.document,
            createdBy: userId,
        });
        await this.versionRepo.save(version);

        report.currentVersionNumber = nextVersionNumber;
        report.chatHistory = generated.chatHistory;
        report.updatedBy = userId;
        await this.reportRepo.save(report);

        return this.getReport(report.id);
    }

    async regenerateReport(reportId: string, payload: {
        instruction?: string | null;
        targetSectionKey?: ReviewReportSectionKey | null;
    }, userId: string | null) {
        await this.ensureSchemaReady();
        const report = await this.requireReport(reportId);
        const currentVersion = await this.requireCurrentVersion(report);
        const template = this.getTemplate(report.templateType);
        const generated = await this.generateDocument({
            template,
            filters: this.normalizeFilters(report.filters),
            currentDocument: currentVersion.document,
            instruction: payload.instruction ? String(payload.instruction).trim() : null,
            targetSectionKey: payload.targetSectionKey || null,
            userId,
            existingChatHistory: report.chatHistory || [],
        });

        const nextVersionNumber = report.currentVersionNumber + 1;
        const version = this.versionRepo.create({
            id: uuidv4(),
            reportId: report.id,
            versionNumber: nextVersionNumber,
            generationType: payload.targetSectionKey ? "section_regenerated" : "regenerated",
            targetSectionKey: payload.targetSectionKey || null,
            instruction: payload.instruction ? String(payload.instruction).trim() : null,
            document: generated.document,
            createdBy: userId,
        });
        await this.versionRepo.save(version);

        report.currentVersionNumber = nextVersionNumber;
        report.chatHistory = generated.chatHistory;
        report.updatedBy = userId;
        await this.reportRepo.save(report);

        return this.getReport(report.id);
    }

    async saveSectionEdit(reportId: string, sectionKey: ReviewReportSectionKey, content: string, userId: string | null) {
        await this.ensureSchemaReady();
        const report = await this.requireReport(reportId);
        const currentVersion = await this.requireCurrentVersion(report);
        const nextSections = currentVersion.document.sections.map((section) =>
            section.key === sectionKey
                ? {
                    ...section,
                    content,
                    edited: true,
                    editedBy: userId,
                    editedAt: new Date().toISOString(),
                }
                : section
        );
        if (!nextSections.some((section) => section.key === sectionKey)) {
            throw new Error("Section not found");
        }

        const nextDocument: ReviewReportDocument = {
            ...currentVersion.document,
            sections: nextSections,
        };

        const nextVersionNumber = report.currentVersionNumber + 1;
        const version = this.versionRepo.create({
            id: uuidv4(),
            reportId: report.id,
            versionNumber: nextVersionNumber,
            generationType: "manual_edit",
            targetSectionKey: sectionKey,
            instruction: null,
            document: nextDocument,
            createdBy: userId,
        });
        await this.versionRepo.save(version);

        report.currentVersionNumber = nextVersionNumber;
        report.updatedBy = userId;
        await this.reportRepo.save(report);

        return this.getReport(report.id);
    }

    private async generateDocument(args: {
        template: ReviewReportTemplateDefinition;
        filters: ReviewReportFilters;
        currentDocument: ReviewReportDocument | null;
        instruction: string | null;
        targetSectionKey: ReviewReportSectionKey | null;
        userId: string | null;
        existingChatHistory?: ReviewReportChatMessage[];
    }) {
        const cohort = await this.buildCohort(args.filters, args.userId);
        const currentSections = args.currentDocument?.sections || [];
        const targetSectionKeys = args.targetSectionKey
            ? [args.targetSectionKey]
            : args.template.sections.map((section) => section.key);

        const generatedSections = await this.generateSectionsWithAI({
            template: args.template,
            cohort,
            instruction: args.instruction,
            targetSectionKeys,
            currentSections,
        });

        const mergedSections = args.template.sections.map((section) => {
            const regenerated = generatedSections.find((item) => item.key === section.key);
            if (regenerated) return regenerated;
            const existing = currentSections.find((item) => item.key === section.key);
            if (existing) return existing;
            return {
                key: section.key,
                title: section.title,
                content: "",
                edited: false,
                editedBy: null,
                editedAt: null,
            } satisfies ReviewReportSection;
        });

        const document: ReviewReportDocument = {
            title: this.buildDocumentTitle(args.template, args.filters),
            subtitle: this.buildDocumentSubtitle(args.filters, cohort),
            templateType: args.template.type,
            filters: args.filters,
            cohort: cohort.metrics,
            sections: mergedSections,
        };

        const chatHistory = [...(args.existingChatHistory || [])];
        if (args.instruction) {
            chatHistory.push({
                role: "user",
                content: args.instruction,
                targetSectionKey: args.targetSectionKey,
                createdAt: new Date().toISOString(),
            });
        } else if (!chatHistory.length) {
            chatHistory.push({
                role: "assistant",
                content: `Generated ${args.template.label} report draft.`,
                targetSectionKey: null,
                createdAt: new Date().toISOString(),
            });
        }
        chatHistory.push({
            role: "assistant",
            content: args.targetSectionKey
                ? `Updated ${this.getSectionTitle(args.template, args.targetSectionKey)}.`
                : `Generated ${args.template.label} report draft.`,
            targetSectionKey: args.targetSectionKey,
            createdAt: new Date().toISOString(),
        });

        return { document, chatHistory };
    }

    private async buildCohort(filters: ReviewReportFilters, userId: string | null) {
        const rows = await this.fetchReportRows(filters, userId);
        const reservationIds = rows.map((row: any) => Number(row.reservationInfo?.id)).filter((id: number) => !Number.isNaN(id));
        const aiRefresh = await this.refreshAiAnalysis(reservationIds);
        const latestAnalyses = reservationIds.length
            ? await this.guestAnalysisService.getAnalysesByReservations(reservationIds)
            : [];
        const analysisMap = new Map(latestAnalyses.map((analysis) => [Number(analysis.reservationId), analysis]));
        const contexts = await Promise.all(rows.map(async (row: any) => {
            const reservationId = Number(row.reservationInfo?.id);
            const communications = await this.guestCommunicationService.getAllCommunicationsForReservation(reservationId);
            const review = this.resolveReviewOutcome(row);
            const updates = (row.reviewCheckoutUpdates || []).map((update: any) => String(update?.updates || "").trim()).filter(Boolean);
            const latestUpdate = String(row.reservationInfo?.latestUpdate?.content || "").trim() || null;
            const resolutionNotes = String(row.reservationInfo?.resolutionNotes || "").trim() || null;
            const actionEvidence = [
                ...communications
                    .filter((message) => String(message.direction).toLowerCase() === "outbound")
                    .map((message) => `Guest communication (${message.source}) on ${format(new Date(message.communicatedAt), "MMM d, yyyy h:mm a")}: ${String(message.content || "").slice(0, 200)}`),
                ...updates.map((update) => `Latest Update: ${update}`),
                ...(latestUpdate && !updates.includes(latestUpdate) ? [`Latest Update: ${latestUpdate}`] : []),
                ...(resolutionNotes ? [`Resolution Notes: ${resolutionNotes}`] : []),
            ].filter(Boolean);
            const meaningfulAction = actionEvidence.length > 0;
            const negotiation = this.classifyNegotiation({
                review,
                meaningfulAction,
                actionEvidence,
            });

            return {
                reservationId,
                guestName: row.reservationInfo?.guestName || null,
                listingName: row.reservationInfo?.listingName || null,
                propertyType: row.reservationInfo?.propertyType || null,
                serviceType: row.reservationInfo?.serviceType || null,
                channelName: row.reservationInfo?.channelName || row.reservationInfo?.source || null,
                arrivalDate: row.reservationInfo?.arrivalDate ? format(new Date(row.reservationInfo.arrivalDate), "yyyy-MM-dd") : null,
                departureDate: row.reservationInfo?.departureDate ? format(new Date(row.reservationInfo.departureDate), "yyyy-MM-dd") : null,
                latestUpdate,
                resolutionNotes,
                updateHistory: updates,
                communications: (communications || []).map((message) => ({
                    source: message.source,
                    direction: message.direction,
                    communicatedAt: new Date(message.communicatedAt).toISOString(),
                    content: String(message.content || ""),
                })),
                aiAnalysis: analysisMap.get(reservationId) || row.reservationInfo?.aiAnalysis || null,
                review,
                negotiation,
            } satisfies ReservationReportContext;
        }));

        const comparison = await this.buildComparisonMetrics(filters, userId);
        const metrics = this.buildCohortMetrics(contexts, aiRefresh, comparison);
        return { contexts, metrics };
    }

    private async fetchReportRows(filters: ReviewReportFilters, userId: string | null) {
        const reviewData = await this.reviewService.getReviewsForCheckout({
            page: 1,
            limit: 5000,
            listingMapId: filters.listingId || [],
            channel: (filters.channel || []) as any,
            propertyType: filters.propertyType || [],
            serviceType: filters.serviceType || [],
            fromDate: filters.fromDate || undefined,
            toDate: filters.toDate || undefined,
            dateType: filters.dateType || "departureDate",
            status: [],
            tab: "",
            keyword: "",
            owner: [],
            visibility: [],
            refundStatus: [],
            operationalFlags: [],
            rating: [],
            actionItemsStatus: [],
            issuesStatus: [],
            sentiment: [],
        } as any, userId || "system");
        return reviewData.result || [];
    }

    private async refreshAiAnalysis(reservationIds: number[]) {
        const attempted = reservationIds.length;
        let succeeded = 0;
        let failed = 0;
        await this.runInChunks(reservationIds, 3, async (reservationId) => {
            try {
                await this.guestAnalysisService.analyzeGuestCommunication(reservationId, undefined, "auto-report");
                succeeded += 1;
            } catch (error: any) {
                failed += 1;
                logger.error(`[ReviewReportsService] Failed to refresh AI analysis for reservation ${reservationId}: ${error?.message || error}`);
            }
        });
        return { attempted, succeeded, failed };
    }

    private async runInChunks<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
        const queue = [...items];
        const runners = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
            while (queue.length > 0) {
                const next = queue.shift();
                if (next === undefined) return;
                await worker(next);
            }
        });
        await Promise.all(runners);
    }

    private resolveReviewOutcome(row: any): ReviewOutcome {
        const reviews = Array.isArray(row.reviews) ? [...row.reviews] : [];
        reviews.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        const primary = reviews[0] || row.reservationInfo?.review || null;
        const rating = primary?.rating != null ? Number(primary.rating) : null;
        return {
            rating: Number.isNaN(rating as number) ? null : rating,
            hasReview: !!primary,
            reviewText: primary?.publicReview || primary?.privateReview || null,
            reviewVisibility: primary?.visibility || null,
        };
    }

    private classifyNegotiation(args: {
        review: ReviewOutcome;
        meaningfulAction: boolean;
        actionEvidence: string[];
    }) {
        if (args.review.rating === 5) {
            return {
                classification: "success" as const,
                reason: "Guest left a 5-star review after visible team action.",
                meaningfulAction: args.meaningfulAction,
                evidence: args.actionEvidence.slice(0, 5),
            };
        }

        if (args.review.rating != null && args.review.rating < 5) {
            return {
                classification: "failure" as const,
                reason: args.meaningfulAction
                    ? "Guest left a below-5-star review despite review-management effort."
                    : "Guest left a below-5-star review with no meaningful recovery effort documented.",
                meaningfulAction: args.meaningfulAction,
                evidence: args.actionEvidence.slice(0, 5),
            };
        }

        if (!args.review.hasReview && args.meaningfulAction) {
            return {
                classification: "failure" as const,
                reason: "No review was captured after documented mitigation or review-prevention effort.",
                meaningfulAction: args.meaningfulAction,
                evidence: args.actionEvidence.slice(0, 5),
            };
        }

        return {
            classification: "neutral" as const,
            reason: "No clear negative outcome and no meaningful negotiation effort documented.",
            meaningfulAction: args.meaningfulAction,
            evidence: args.actionEvidence.slice(0, 5),
        };
    }

    private buildCohortMetrics(
        contexts: ReservationReportContext[],
        aiRefresh: { attempted: number; succeeded: number; failed: number },
        comparison: ReviewReportDocument["cohort"]["comparison"]
    ): ReviewReportDocument["cohort"] {
        const ratings = contexts.map((item) => item.review.rating).filter((value): value is number => value != null);
        const averageRating = ratings.length
            ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2))
            : null;
        const propertyTypeBreakdown = this.buildCountList(contexts.map((item) => item.propertyType || "Unknown"));
        const channelBreakdown = this.buildCountList(contexts.map((item) => item.channelName || "Unknown"));

        return {
            totalReservations: contexts.length,
            reviewedReservations: contexts.filter((item) => item.review.hasReview).length,
            fiveStarReviews: contexts.filter((item) => item.review.rating === 5).length,
            belowFiveStarReviews: contexts.filter((item) => item.review.rating != null && item.review.rating < 5).length,
            noReviewReservations: contexts.filter((item) => !item.review.hasReview).length,
            averageRating,
            propertyTypeBreakdown,
            channelBreakdown,
            aiRefresh,
            warnings: aiRefresh.failed > 0 ? [`${aiRefresh.failed} reservations could not be refreshed in AI Analysis before generation.`] : [],
            comparison,
        };
    }

    private async buildComparisonMetrics(filters: ReviewReportFilters, userId: string | null) {
        if (!filters.fromDate || !filters.toDate) return null;
        try {
            const from = parseISO(filters.fromDate);
            const to = parseISO(filters.toDate);
            const span = differenceInCalendarDays(to, from);
            const prevTo = subDays(from, 1);
            const prevFrom = subDays(prevTo, span);
            const previousFilters: ReviewReportFilters = {
                ...filters,
                fromDate: format(prevFrom, "yyyy-MM-dd"),
                toDate: format(prevTo, "yyyy-MM-dd"),
            };
            const previousRows = await this.fetchReportRows(previousFilters, userId);
            const previousContexts = previousRows.map((row: any) => ({
                review: this.resolveReviewOutcome(row),
            }));
            const previousRatings = previousContexts
                .map((item) => item.review.rating)
                .filter((value): value is number => value != null);
            return {
                label: `${format(prevFrom, "MMM d")} – ${format(prevTo, "MMM d, yyyy")}`,
                totalReservations: previousRows.length,
                reviewedReservations: previousContexts.filter((item) => item.review.hasReview).length,
                fiveStarReviews: previousContexts.filter((item) => item.review.rating === 5).length,
                belowFiveStarReviews: previousContexts.filter((item) => item.review.rating != null && item.review.rating < 5).length,
                averageRating: previousRatings.length
                    ? Number((previousRatings.reduce((sum, value) => sum + value, 0) / previousRatings.length).toFixed(2))
                    : null,
            };
        } catch {
            return null;
        }
    }

    private async generateSectionsWithAI(args: {
        template: ReviewReportTemplateDefinition;
        cohort: Awaited<ReturnType<ReviewReportsService["buildCohort"]>>;
        instruction: string | null;
        targetSectionKeys: ReviewReportSectionKey[];
        currentSections: ReviewReportSection[];
    }) {
        const targetSectionDefinitions = args.template.sections.filter((section) => args.targetSectionKeys.includes(section.key));
        const promptPayload = {
            template: {
                type: args.template.type,
                label: args.template.label,
                description: args.template.description,
                sections: targetSectionDefinitions,
            },
            instruction: args.instruction,
            cohort: {
                metrics: args.cohort.metrics,
                reservations: args.cohort.contexts.slice(0, 200).map((context) => ({
                    reservationId: context.reservationId,
                    guestName: context.guestName,
                    listingName: context.listingName,
                    propertyType: context.propertyType,
                    serviceType: context.serviceType,
                    channelName: context.channelName,
                    arrivalDate: context.arrivalDate,
                    departureDate: context.departureDate,
                    review: context.review,
                    aiAnalysis: context.aiAnalysis
                        ? {
                            summary: context.aiAnalysis.summary,
                            sentiment: context.aiAnalysis.sentiment,
                            sentimentReason: context.aiAnalysis.sentimentReason,
                            flags: context.aiAnalysis.flags || [],
                            analyzedAt: context.aiAnalysis.analyzedAt,
                        }
                        : null,
                    latestUpdate: context.latestUpdate,
                    resolutionNotes: context.resolutionNotes,
                    updateHistory: context.updateHistory.slice(0, 5),
                    communications: context.communications.slice(0, 8),
                    negotiation: context.negotiation,
                })),
            },
            currentSections: args.currentSections.filter((section) => args.targetSectionKeys.includes(section.key)),
            rules: {
                operationalFailures: "Use latest AI analysis of guest conversations. Include red and green operational flags where relevant, but focus operational failures on negative patterns, evidence, and ownership.",
                negotiationClassification: {
                    success: "Only if the guest left a 5-star review.",
                    failure: "Only if the guest left below 5 stars, or if no review was left after documented mitigation / review-prevention effort.",
                    neutral: "If no meaningful team action appears in guest communication and internal notes, and the outcome was not bad.",
                },
                negotiationInputs: "Use guest communications, call summaries/transcripts, latest updates, and resolution notes together. Do not rely only on internal notes.",
            },
        };

        const systemPrompt = [
            "You are generating an internal weekly reviews report for a hospitality operations team.",
            "Return valid JSON only.",
            "Output shape: { sections: [{ key, title, content }] }.",
            "Each section content should be polished, actionable, and decision-ready.",
            "Preserve manual edits in non-target sections by only returning the requested sections.",
            "If instruction asks for comparison to last week and comparison data is missing, acknowledge that comparison baseline is not yet available instead of inventing numbers.",
        ].join(" ");

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                temperature: 0.25,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: JSON.stringify(promptPayload) },
                ],
            });
            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error("No response from OpenAI");
            const parsed = JSON.parse(content) as { sections?: Array<Partial<ReviewReportSection>> };
            const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
            return targetSectionDefinitions.map((definition) => {
                const matched = sections.find((section) => section.key === definition.key);
                return {
                    key: definition.key,
                    title: definition.title,
                    content: String(matched?.content || "").trim() || this.buildFallbackSection(definition.key, args.cohort.contexts, args.cohort.metrics),
                    edited: false,
                    editedBy: null,
                    editedAt: null,
                } satisfies ReviewReportSection;
            });
        } catch (error: any) {
            logger.error("[ReviewReportsService] Failed to generate review report sections", error?.message || error);
            return targetSectionDefinitions.map((definition) => ({
                key: definition.key,
                title: definition.title,
                content: this.buildFallbackSection(definition.key, args.cohort.contexts, args.cohort.metrics),
                edited: false,
                editedBy: null,
                editedAt: null,
            }));
        }
    }

    private buildFallbackSection(
        key: ReviewReportSectionKey,
        contexts: ReservationReportContext[],
        metrics: ReviewReportDocument["cohort"]
    ) {
        const topFlags = this.buildCountList(
            contexts.flatMap((context) => (context.aiAnalysis?.flags || []).map((flag: any) => flag.flag || "Unknown"))
        ).slice(0, 5);
        const failures = contexts.filter((context) => context.negotiation.classification === "failure");
        const successes = contexts.filter((context) => context.negotiation.classification === "success");
        switch (key) {
            case "executive_summary":
                return `This cohort includes ${metrics.totalReservations} reservations, with ${metrics.reviewedReservations} reviewed stays and an average rating of ${metrics.averageRating ?? "N/A"}. ${metrics.belowFiveStarReviews} reservations resulted in below-5-star reviews, while ${metrics.noReviewReservations} had no review captured.`;
            case "review_performance":
                return `Review performance shows ${metrics.fiveStarReviews} five-star reviews, ${metrics.belowFiveStarReviews} below-5-star reviews, and ${metrics.noReviewReservations} stays without a review. Top channels were ${metrics.channelBreakdown.slice(0, 3).map((item) => `${item.label} (${item.count})`).join(", ") || "none"}.`;
            case "operational_failures":
                return `Operational failures most often surfaced in ${topFlags.map((item) => `${item.label} (${item.count})`).join(", ") || "no repeated categories"}. Use the refreshed AI analysis records to validate ownership and recurring gaps before actioning follow-ups.`;
            case "negotiation_performance":
                return `Negotiation outcomes include ${successes.length} successes and ${failures.length} failures under the defined rules. Failures were driven by below-5-star outcomes or no-review outcomes after mitigation effort, while successes were limited to confirmed 5-star reviews.`;
            case "action_plan":
                return `Prioritize the repeated operational flags, coach teams on failed negotiation patterns, and audit reservations with mitigation effort but no review outcome.`;
            case "category_department_breakdown":
                return `The strongest recurring issue categories were ${topFlags.map((item) => item.label).join(", ") || "none identified"}. Use department ownership from the AI analysis outputs to assign follow-up actions.`;
            case "notable_reservations":
                return contexts.slice(0, 5).map((context) => `Reservation ${context.reservationId} — ${context.listingName || "Unknown property"}: ${context.aiAnalysis?.summary || context.negotiation.reason}`).join("\n");
            case "coaching_opportunities":
                return failures.slice(0, 5).map((context) => `${context.listingName || "Unknown property"} (${context.reservationId}): ${context.negotiation.reason}`).join("\n") || "No immediate coaching opportunities identified.";
            default:
                return "";
        }
    }

    private buildDocumentTitle(template: ReviewReportTemplateDefinition, filters: ReviewReportFilters) {
        const dateLabel = filters.fromDate && filters.toDate
            ? `${format(parseISO(filters.fromDate), "MMM d")} – ${format(parseISO(filters.toDate), "MMM d, yyyy")}`
            : "Open Date Range";
        return `${template.label} Report`;
        // subtitle carries the specific date context
    }

    private buildDocumentSubtitle(filters: ReviewReportFilters, cohort: Awaited<ReturnType<ReviewReportsService["buildCohort"]>>) {
        const dateLabel = filters.fromDate && filters.toDate
            ? `${format(parseISO(filters.fromDate), "MMM d")} – ${format(parseISO(filters.toDate), "MMM d, yyyy")}`
            : "All available dates";
        return `${dateLabel} • ${cohort.metrics.totalReservations} reservations in scope`;
    }

    private getTemplate(type: ReviewReportTemplateType) {
        const template = REVIEW_REPORT_TEMPLATES.find((entry) => entry.type === type);
        if (!template) {
            throw new Error("Invalid report template");
        }
        return template;
    }

    private getSectionTitle(template: ReviewReportTemplateDefinition, sectionKey: ReviewReportSectionKey) {
        return template.sections.find((section) => section.key === sectionKey)?.title || sectionKey;
    }

    private async requireReport(reportId: string) {
        const report = await this.reportRepo.findOne({ where: { id: reportId } });
        if (!report) {
            throw new Error("Report not found");
        }
        return report;
    }

    private async requireCurrentVersion(report: ReviewReportEntity) {
        const currentVersion = await this.versionRepo.findOne({
            where: { reportId: report.id, versionNumber: report.currentVersionNumber },
        });
        if (!currentVersion) {
            throw new Error("Current report version not found");
        }
        return currentVersion;
    }

    private normalizeFilters(filters: ReviewReportFilters): ReviewReportFilters {
        const normalized: ReviewReportFilters = {
            fromDate: filters.fromDate || null,
            toDate: filters.toDate || null,
            dateType: filters.dateType === "arrivalDate" ? "arrivalDate" : "departureDate",
            listingId: Array.isArray(filters.listingId) ? filters.listingId.map((value) => Number(value)).filter((value) => !Number.isNaN(value)) : [],
            propertyType: Array.isArray(filters.propertyType) ? filters.propertyType.filter(Boolean) : [],
            channel: Array.isArray(filters.channel) ? filters.channel.filter((value) => value !== null && value !== undefined && value !== "") : [],
            serviceType: Array.isArray(filters.serviceType) ? filters.serviceType.filter(Boolean) : [],
        };
        return normalized;
    }

    private buildCountList(values: string[]) {
        const counts = new Map<string, number>();
        values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
        return Array.from(counts.entries())
            .map(([label, count]) => ({ label, count }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    }

    private async ensureSchemaReady() {
        if (!this.schemaReadyPromise) {
            this.schemaReadyPromise = this.bootstrapSchema();
        }
        return this.schemaReadyPromise;
    }

    private async bootstrapSchema() {
        try {
            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS review_reports (
                  id VARCHAR(36) NOT NULL PRIMARY KEY,
                  name VARCHAR(180) NOT NULL,
                  templateType VARCHAR(64) NOT NULL,
                  filters JSON NOT NULL,
                  chatHistory JSON NULL,
                  linkedAiThreadId VARCHAR(36) NULL,
                  currentVersionNumber INT NOT NULL DEFAULT 1,
                  createdBy VARCHAR(120) NULL,
                  updatedBy VARCHAR(120) NULL,
                  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_review_reports_templateType_updatedAt (templateType, updatedAt)
                )
            `);

            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS review_report_versions (
                  id VARCHAR(36) NOT NULL PRIMARY KEY,
                  reportId VARCHAR(36) NOT NULL,
                  versionNumber INT NOT NULL,
                  generationType VARCHAR(48) NOT NULL,
                  targetSectionKey VARCHAR(64) NULL,
                  instruction LONGTEXT NULL,
                  document JSON NOT NULL,
                  createdBy VARCHAR(120) NULL,
                  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_review_report_versions_reportId_versionNumber (reportId, versionNumber)
                )
            `);
        } catch (error: any) {
            this.schemaReadyPromise = null;
            logger.error(`[ReviewReportsService] Failed to ensure review report schema: ${error?.message || error}`);
            throw new Error("Review report tables are not ready");
        }
    }
}
