import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { In, IsNull, Like } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { GuestAnalysisService, type GuestAnalysisDetailContext, type GuestAnalysisRecord, type SentimentType } from "./GuestAnalysisService";
import { GuestCommunicationService } from "./GuestCommunicationService";
import { ReservationAICopilotEvidenceItem, ReservationAICopilotMessageEntity, ReservationAICopilotThreadEntity } from "../entity/ReservationAICopilot";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { ReviewEntity } from "../entity/Review";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import { Issue } from "../entity/Issue";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { ExpenseEntity } from "../entity/Expense";
import { ReviewDiscussionMessageEntity } from "../entity/ReviewDiscussionMessage";
import { ReservationInfoEntity } from "../entity/ReservationInfo";

interface CopilotAnswerPayload {
    answer: string;
    insufficientEvidence: boolean;
    evidence: ReservationAICopilotEvidenceItem[];
}

interface SendReservationCopilotMessageInput {
    reservationId: number;
    content: string;
    userId?: string | null;
}

interface ReservationCopilotThreadResponse {
    id: string;
    reservationId: number;
    name: string;
    isActive: boolean;
    lastRefreshedAt: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        evidenceItems: ReservationAICopilotEvidenceItem[];
        contextMeta: Record<string, any> | null;
        createdBy: string | null;
        createdAt: string;
        updatedAt: string;
    }>;
}

export class ReservationAICopilotService {
    private threadRepo = appDatabase.getRepository(ReservationAICopilotThreadEntity);
    private messageRepo = appDatabase.getRepository(ReservationAICopilotMessageEntity);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdateRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private reviewRepo = appDatabase.getRepository(ReviewEntity);
    private reviewDetailRepo = appDatabase.getRepository(ReviewDetailEntity);
    private issueRepo = appDatabase.getRepository(Issue);
    private refundRequestRepo = appDatabase.getRepository(RefundRequestEntity);
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private discussionRepo = appDatabase.getRepository(ReviewDiscussionMessageEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private analysisService = new GuestAnalysisService();
    private communicationService = new GuestCommunicationService();
    private openai: OpenAI;
    private schemaReady = false;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
    }

    async getOrCreateReservationThread(reservationId: number, userId?: string | null): Promise<ReservationCopilotThreadResponse> {
        await this.ensureSchema();
        let thread = await this.threadRepo.findOne({
            where: { reservationId, isActive: true },
            order: { updatedAt: "DESC" },
        });

        if (!thread) {
            thread = await this.threadRepo.save(this.threadRepo.create({
                id: uuidv4(),
                reservationId,
                name: "Reservation AI Copilot",
                isActive: true,
                createdBy: userId || null,
                lastRefreshedAt: null,
            }));
        }

        return this.serializeThread(thread);
    }

    async resetReservationThread(reservationId: number, userId?: string | null): Promise<ReservationCopilotThreadResponse> {
        await this.ensureSchema();
        const existing = await this.threadRepo.find({
            where: { reservationId, isActive: true },
            order: { updatedAt: "DESC" },
        });

        if (existing.length) {
            for (const thread of existing) {
                thread.isActive = false;
            }
            await this.threadRepo.save(existing);
        }

        const nextThread = await this.threadRepo.save(this.threadRepo.create({
            id: uuidv4(),
            reservationId,
            name: "Reservation AI Copilot",
            isActive: true,
            createdBy: userId || null,
            lastRefreshedAt: null,
        }));

        return this.serializeThread(nextThread);
    }

    async refreshReservationAnalysis(reservationId: number, inboxId?: string, userId?: string | null): Promise<ReservationCopilotThreadResponse> {
        await this.ensureSchema();
        await this.analysisService.regenerateAnalysis(reservationId, inboxId);
        const thread = await this.getOrCreateReservationThread(reservationId, userId);
        const threadEntity = await this.threadRepo.findOne({ where: { id: thread.id } });
        if (threadEntity) {
            threadEntity.lastRefreshedAt = new Date();
            await this.threadRepo.save(threadEntity);
        }
        return this.getOrCreateReservationThread(reservationId, userId);
    }

    async sendMessage(input: SendReservationCopilotMessageInput): Promise<ReservationCopilotThreadResponse> {
        await this.ensureSchema();
        const thread = await this.getOrCreateReservationThread(input.reservationId, input.userId);
        const trimmedContent = String(input.content || "").trim();
        if (!trimmedContent) {
            throw new Error("A message is required");
        }

        await this.messageRepo.save(this.messageRepo.create({
            id: uuidv4(),
            threadId: thread.id,
            reservationId: input.reservationId,
            role: "user",
            content: trimmedContent,
            evidenceItems: null,
            contextMeta: null,
            createdBy: input.userId || null,
        }));

        const retrieval = await this.buildRetrievalContext(input.reservationId);
        const priorMessages = thread.messages.slice(-10).map((message) => ({
            role: message.role,
            content: message.content,
        }));
        const answer = await this.generateGroundedAnswer(trimmedContent, retrieval, priorMessages);

        await this.messageRepo.save(this.messageRepo.create({
            id: uuidv4(),
            threadId: thread.id,
            reservationId: input.reservationId,
            role: "assistant",
            content: answer.answer,
            evidenceItems: answer.evidence,
            contextMeta: {
                insufficientEvidence: answer.insufficientEvidence,
                generatedFrom: "latest_saved_analysis",
                relatedPropertyRecordCount: retrieval.propertyPatternCount,
                relatedCategoryLabels: retrieval.categoryLabels,
                relatedDepartmentLabels: retrieval.departmentLabels,
            },
            createdBy: input.userId || null,
        }));

        return this.getOrCreateReservationThread(input.reservationId, input.userId);
    }

    private async serializeThread(thread: ReservationAICopilotThreadEntity): Promise<ReservationCopilotThreadResponse> {
        const messages = await this.messageRepo.find({
            where: { threadId: thread.id },
            order: { createdAt: "ASC" },
        });

        return {
            id: thread.id,
            reservationId: Number(thread.reservationId),
            name: thread.name,
            isActive: Boolean(thread.isActive),
            lastRefreshedAt: thread.lastRefreshedAt ? thread.lastRefreshedAt.toISOString() : null,
            createdBy: thread.createdBy || null,
            createdAt: thread.createdAt.toISOString(),
            updatedAt: thread.updatedAt.toISOString(),
            messages: messages.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                evidenceItems: message.evidenceItems || [],
                contextMeta: message.contextMeta || null,
                createdBy: message.createdBy || null,
                createdAt: message.createdAt.toISOString(),
                updatedAt: message.updatedAt.toISOString(),
            })),
        };
    }

    private async buildRetrievalContext(reservationId: number) {
        const [detail, communications] = await Promise.all([
            this.analysisService.getAnalysisDetailContext(reservationId),
            this.communicationService.getAllCommunicationsForReservation(reservationId),
        ]);

        if (!detail) {
            throw new Error("No AI analysis detail found for this reservation");
        }

        const reviewDetailContext = await this.buildReviewDetailContext(reservationId);

        return {
            reservationId,
            detail,
            communications,
            reviewDetailContext,
            propertyPatternCount: detail.propertyContext.records.length,
            categoryLabels: detail.categoryContext.map((item) => item.label),
            departmentLabels: detail.departmentContext.map((item) => item.label),
            promptContext: this.buildPromptContext(detail, communications, reviewDetailContext),
        };
    }

    private async buildReviewDetailContext(reservationId: number) {
        const [reservation, reviewCheckout, review, discussionMessages, issues, refundRequests] = await Promise.all([
            this.reservationRepo.findOne({ where: { id: reservationId } }),
            this.reviewCheckoutRepo.findOne({ where: { reservationInfo: { id: reservationId } } as any }),
            this.reviewRepo.findOne({ where: { reservationId } as any }),
            this.discussionRepo.find({
                where: { reservationId },
                order: { createdAt: "DESC" },
                take: 10,
            }),
            this.issueRepo.find({
                where: [
                    { reservation_id: String(reservationId) },
                    { linked_reservations: Like(`%${reservationId}%`) },
                ] as any,
                order: { updated_at: "DESC" },
                take: 8,
            }),
            this.refundRequestRepo.find({
                where: { reservationId, deletedAt: IsNull() } as any,
                order: { updatedAt: "DESC" },
                take: 6,
            }),
        ]);

        const [reviewCheckoutUpdates, reviewDetail, directExpenses] = await Promise.all([
            reviewCheckout?.id
                ? this.reviewCheckoutUpdateRepo.find({
                    where: { reviewCheckout: { id: reviewCheckout.id } } as any,
                    order: { createdAt: "DESC" },
                    take: 8,
                })
                : Promise.resolve([]),
            review?.id
                ? this.reviewDetailRepo.findOne({
                    where: { reviewId: review.id },
                    relations: ["removalAttempts"],
                })
                : Promise.resolve(null),
            this.expenseRepo.find({
                where: { reservationId: String(reservationId), isDeleted: 0 } as any,
                order: { updatedAt: "DESC" },
                take: 8,
            }),
        ]);

        const refundExpenseIds = refundRequests
            .map((request) => Number(request.expenseId))
            .filter((value) => Number.isFinite(value) && value > 0);
        const refundExpenses = refundExpenseIds.length
            ? await this.expenseRepo.find({
                where: { id: In(refundExpenseIds), isDeleted: 0 } as any,
                order: { updatedAt: "DESC" },
                take: 8,
            })
            : [];
        const expensesById = new Map<number, ExpenseEntity>();
        [...directExpenses, ...refundExpenses].forEach((expense) => {
            expensesById.set(Number(expense.id), expense);
        });

        return {
            mitigation: {
                reviewCheckoutId: reviewCheckout?.id || null,
                status: reviewCheckout?.status || null,
                assignee: reviewCheckout?.assignee || null,
                visibility: reviewCheckout?.visibility || review?.visibility || null,
                resolutionNotes: this.truncate(reviewCheckout?.comments || "", 900),
                isActive: reviewCheckout?.isActive ?? null,
                adjustedCheckoutDate: reviewCheckout?.adjustedCheckoutDate || null,
                sevenDaysAfterCheckout: reviewCheckout?.sevenDaysAfterCheckout || null,
                fourteenDaysAfterCheckout: reviewCheckout?.fourteenDaysAfterCheckout || null,
                slackThreadTs: reviewCheckout?.slackThreadTs || null,
                slackChannelId: reviewCheckout?.slackChannelId || null,
                updatedAt: reviewCheckout?.updatedAt instanceof Date ? reviewCheckout.updatedAt.toISOString() : null,
                updates: reviewCheckoutUpdates.map((update) => ({
                    content: this.truncate(update.updates || "", 420),
                    source: update.source || null,
                    createdBy: update.createdBy || null,
                    createdAt: update.createdAt instanceof Date ? update.createdAt.toISOString() : null,
                })),
            },
            reservationOperationalState: {
                reservationStatus: reservation?.status || null,
                paymentStatus: reservation?.paymentStatus || null,
                reservationTags: this.splitTags(reservation?.tags),
                hostNote: this.truncate(reservation?.hostNote || "", 500),
                ownerRevenue: reservation?.owner_revenue ?? null,
                totalPaid: reservation?.airbnbTotalPaidAmount ?? null,
                daysLeft: this.calculateDaysLeft(reservation?.departureDate),
            },
            review: review ? {
                reviewId: review.id,
                rating: review.rating ?? null,
                visibility: review.visibility || null,
                publicReview: this.truncate(review.publicReview || "", 700),
                publicReviewSentiment: review.publicReviewSentiment || null,
                publicReviewSentimentReason: this.truncate(review.publicReviewSentimentReason || "", 500),
                privateReview: this.truncate(review.privateReview || "", 700),
                privateReviewSentiment: review.reviewSentiment || null,
                privateReviewSentimentReason: this.truncate(review.reviewSentimentReason || "", 500),
                submittedAt: review.submittedAt || null,
                isHidden: review.isHidden ?? null,
            } : null,
            reviewDetail: reviewDetail ? {
                guestPhone: reviewDetail.guestPhone || null,
                guestEmail: reviewDetail.guestEmail || null,
                bookingAmount: reviewDetail.bookingAmount ?? null,
                claimResolutionStatus: reviewDetail.claimResolutionStatus || null,
                resolutionAmount: reviewDetail.resolutionAmount ?? null,
                resolutionDateRequested: reviewDetail.resolutionDateRequested || null,
                expenseId: reviewDetail.expenseId || null,
                removalAttempts: (reviewDetail.removalAttempts || []).slice(0, 6).map((attempt) => ({
                    dateAttempted: attempt.dateAttempted || null,
                    result: attempt.result || null,
                    details: this.truncate(attempt.details || "", 420),
                    resolutionAmount: attempt.resolutionAmount ?? null,
                    refundRequestId: attempt.refundRequestId || null,
                })),
            } : null,
            linkedIssues: issues.map((issue) => ({
                id: issue.id,
                status: issue.status || null,
                category: issue.category || null,
                assignee: issue.assignee || null,
                urgency: issue.urgency ?? null,
                description: this.truncate(issue.issue_description || "", 500),
                ownerNotes: this.truncate(issue.owner_notes || "", 420),
                nextSteps: this.truncate(issue.next_steps || "", 420),
                resolution: this.truncate(issue.resolution || "", 420),
                aiResolutionStatus: issue.ai_resolution_status || null,
                aiGuestSentiment: issue.ai_guest_sentiment || null,
                updatedAt: issue.updated_at instanceof Date ? issue.updated_at.toISOString() : null,
            })),
            refundRequests: refundRequests.map((request) => ({
                id: request.id,
                status: request.status || null,
                amount: request.refundAmount ?? null,
                chargeToClient: Boolean(request.chargeToClient),
                paymentMethod: request.paymentMethod || null,
                paymentDetails: this.truncate(request.paymentDetails || "", 280),
                explanation: this.truncate(request.explaination || "", 700),
                notes: this.truncate(request.notes || "", 500),
                requestedBy: request.requestedBy || null,
                expenseId: request.expenseId || null,
                updatedAt: request.updatedAt instanceof Date ? request.updatedAt.toISOString() : null,
            })),
            expenseLogs: Array.from(expensesById.values()).map((expense) => ({
                id: expense.id,
                status: expense.status || null,
                concept: this.truncate(expense.concept || "", 500),
                amount: expense.amount ?? null,
                categories: this.splitTags(expense.categories),
                paymentMethod: expense.paymentMethod || null,
                paymentDetails: this.truncate(expense.paymentDetails || "", 280),
                comesFrom: expense.comesFrom || null,
                refundLinked: refundRequests.some((request) => Number(request.expenseId) === Number(expense.id)),
                updatedAt: expense.updatedAt instanceof Date ? expense.updatedAt.toISOString() : null,
            })),
            discussion: discussionMessages.map((message) => ({
                sourceType: message.sourceType,
                authorName: message.authorName,
                content: this.truncate(message.content || "", 520),
                createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : null,
                metadata: message.metadata ? {
                    eventType: message.metadata.eventType || null,
                    type: message.metadata.type || null,
                    source: message.metadata.source || null,
                } : null,
            })),
        };
    }

    private buildPromptContext(detail: GuestAnalysisDetailContext, communications: GuestCommunicationEntity[], reviewDetailContext: Record<string, any>) {
        const topCommunications = [...communications]
            .sort((left, right) => new Date(right.communicatedAt).getTime() - new Date(left.communicatedAt).getTime())
            .slice(0, 16)
            .map((message) => ({
                source: message.source,
                direction: message.direction,
                senderName: message.senderName || null,
                communicatedAt: message.communicatedAt instanceof Date ? message.communicatedAt.toISOString() : new Date(message.communicatedAt).toISOString(),
                content: this.truncate(String(message.content || ""), 420),
            }));

        return {
            reservation: {
                reservationId: detail.record.reservationId,
                guestName: detail.record.guestName,
                listingName: detail.record.listingName,
                channelName: detail.record.channelName,
                arrivalDate: detail.record.arrivalDate,
                departureDate: detail.record.departureDate,
                bookingPhase: detail.record.bookingPhase,
                sentiment: detail.record.sentiment,
                sentimentReason: detail.record.sentimentReason,
                summary: detail.record.summary,
                categories: detail.record.categories,
                departments: detail.record.departments,
                flags: (detail.record.flags || []).slice(0, 10).map((flag) => ({
                    flag: flag.flag,
                    explanation: flag.explanation,
                    owner: flag.owner,
                    severity: flag.severity,
                    rootCause: flag.rootCause,
                    evidence: flag.evidence,
                    evidenceAt: flag.evidenceAt,
                    polarity: flag.polarity === "positive" ? "positive" : "negative",
                    phases: flag.phases || [],
                })),
            },
            phaseBreakdown: detail.phaseBreakdown.map((phase) => ({
                phase: phase.phase,
                label: phase.label,
                summary: phase.summary,
                sentiment: phase.sentiment,
                communicationCount: phase.communicationCount,
            })),
            propertyContext: {
                listingName: detail.propertyContext.listingName,
                reservationCount: detail.propertyContext.reservationCount,
                records: detail.propertyContext.records.slice(0, 8).map((record) => this.summarizeRelatedRecord(record)),
            },
            categoryContext: detail.categoryContext.slice(0, 4).map((item) => ({
                label: item.label,
                count: item.count,
                records: item.records.slice(0, 5).map((record) => this.summarizeRelatedRecord(record)),
            })),
            departmentContext: detail.departmentContext.slice(0, 4).map((item) => ({
                label: item.label,
                count: item.count,
                records: item.records.slice(0, 5).map((record) => this.summarizeRelatedRecord(record)),
            })),
            reviewDetailContext,
            recentCommunications: topCommunications,
        };
    }

    private summarizeRelatedRecord(record: GuestAnalysisRecord) {
        return {
            reservationId: record.reservationId,
            guestName: record.guestName,
            listingName: record.listingName,
            bookingPhase: record.bookingPhase,
            sentiment: record.sentiment,
            priority: record.priority,
            status: record.status,
            summary: this.truncate(record.summary || "", 240),
            categories: record.categories,
            departments: record.departments,
            flagCount: record.flagCount,
            analyzedAt: record.analyzedAt instanceof Date ? record.analyzedAt.toISOString() : String(record.analyzedAt || ""),
        };
    }

    private async generateGroundedAnswer(
        userQuestion: string,
        retrieval: Awaited<ReturnType<ReservationAICopilotService["buildRetrievalContext"]>>,
        history: Array<{ role: "user" | "assistant"; content: string }>,
    ): Promise<CopilotAnswerPayload> {
        const systemPrompt = [
            "You are SecureStay's reservation AI copilot.",
            "Answer like a helpful human analyst, but only use the retrieved factual data.",
            "Never guess, speculate, or infer facts not supported by the context.",
            "If evidence is insufficient, say that clearly.",
            "The reservation is the anchor context, but you may use broader property, category, and department patterns when they are included in the retrieval payload.",
            "Always distinguish between current reservation facts and broader historical patterns.",
            "Write the answer as a short, organized narrative with 2 to 4 concise paragraphs.",
            "Use this structure when it fits: **Direct answer**, **Current reservation context**, **Broader pattern**, **Limitations**.",
            "Use bold markdown for the most important keywords or conclusions.",
            "Keep the answer continuous and easy to read; do not write as a list of disconnected snippets.",
            "Return valid JSON only with keys: answer, insufficientEvidence, evidence.",
            "The evidence array must contain concise evidence objects with: type, label, detail, reservationId, timestamp, phase, category, department, polarity.",
            "Use evidence types that best match the source: reservation_summary, operational_flag, communication, phase_summary, property_pattern, category_pattern, department_pattern, review_detail, linked_issue, refund_request, expense_log, discussion_update.",
            "Limit evidence to the most relevant 6 items.",
        ].join(" ");

        const userPrompt = JSON.stringify({
            question: userQuestion,
            conversationHistory: history.slice(-8),
            retrievalContext: retrieval.promptContext,
        });

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("No response from OpenAI");
            }
            return this.parseAnswerPayload(content, retrieval.detail);
        } catch (error: any) {
            logger.error("[ReservationAICopilotService] generateGroundedAnswer failed", error?.message || error);
            return this.buildFallbackAnswer(userQuestion, retrieval.detail);
        }
    }

    private parseAnswerPayload(content: string, detail: GuestAnalysisDetailContext): CopilotAnswerPayload {
        const parsed = JSON.parse(content) as Partial<CopilotAnswerPayload>;
        return {
            answer: String(parsed.answer || "I couldn't build a grounded answer from the available data."),
            insufficientEvidence: Boolean(parsed.insufficientEvidence),
            evidence: Array.isArray(parsed.evidence)
                ? parsed.evidence.slice(0, 6).map((item: any) => ({
                    type: this.normalizeEvidenceType(item?.type),
                    label: String(item?.label || "Supporting evidence"),
                    detail: String(item?.detail || ""),
                    reservationId: item?.reservationId != null ? Number(item.reservationId) : null,
                    timestamp: item?.timestamp ? String(item.timestamp) : null,
                    phase: item?.phase ? String(item.phase) : null,
                    category: item?.category ? String(item.category) : null,
                    department: item?.department ? String(item.department) : null,
                    polarity: item?.polarity === "positive" ? "positive" : item?.polarity === "negative" ? "negative" : null,
                }))
                : this.buildDefaultEvidence(detail),
        };
    }

    private normalizeEvidenceType(value: unknown): ReservationAICopilotEvidenceItem["type"] {
        const allowed: ReservationAICopilotEvidenceItem["type"][] = [
            "reservation_summary",
            "operational_flag",
            "communication",
            "phase_summary",
            "property_pattern",
            "category_pattern",
            "department_pattern",
            "review_detail",
            "linked_issue",
            "refund_request",
            "expense_log",
            "discussion_update",
        ];
        return allowed.includes(String(value) as ReservationAICopilotEvidenceItem["type"])
            ? (String(value) as ReservationAICopilotEvidenceItem["type"])
            : "reservation_summary";
    }

    private buildFallbackAnswer(userQuestion: string, detail: GuestAnalysisDetailContext): CopilotAnswerPayload {
        const lowered = userQuestion.toLowerCase();
        if (lowered.includes("repeated") || lowered.includes("property")) {
            return {
                answer: detail.propertyContext.records.length
                    ? `**Direct answer:** I can see **${detail.propertyContext.records.length} other AI analysis records** tied to this property in the current dataset.\n\n**Broader pattern:** That means there is real historical property context to review here, but I’m limiting the conclusion to the related property evidence below rather than guessing beyond those stored records.`
                    : `**Direct answer:** I don’t have enough related property history in the current dataset to say this is a **repeated property issue**.\n\n**Limitations:** I can only confirm repeat patterns when the stored AI-analysis history for that property contains enough comparable reservations.`,
                insufficientEvidence: detail.propertyContext.records.length === 0,
                evidence: this.buildDefaultEvidence(detail),
            };
        }

        return {
            answer: `**Direct answer:** Based on the latest saved AI analysis for this reservation, ${detail.record.summary || "there isn’t enough stored detail for a stronger conclusion."}\n\n**Current reservation context:** I’m keeping this answer limited to the data currently stored in SecureStay, including the latest analysis, phase summaries, and linked evidence.`,
            insufficientEvidence: false,
            evidence: this.buildDefaultEvidence(detail),
        };
    }

    private buildDefaultEvidence(detail: GuestAnalysisDetailContext): ReservationAICopilotEvidenceItem[] {
        const evidence: ReservationAICopilotEvidenceItem[] = [{
            type: "reservation_summary",
            label: "Current reservation summary",
            detail: detail.record.summary || "No summary available.",
            reservationId: detail.record.reservationId,
            phase: detail.record.bookingPhase,
        }];

        const firstFlag = (detail.record.flags || [])[0];
        if (firstFlag) {
            evidence.push({
                type: "operational_flag",
                label: firstFlag.flag || "Operational flag",
                detail: firstFlag.explanation || "No explanation available.",
                reservationId: detail.record.reservationId,
                timestamp: firstFlag.evidenceAt || null,
                phase: (firstFlag.phases || [])[0] || null,
                category: firstFlag.flag || null,
                department: firstFlag.owner || null,
                polarity: firstFlag.polarity === "positive" ? "positive" : "negative",
            });
        }

        if (detail.propertyContext.records[0]) {
            evidence.push({
                type: "property_pattern",
                label: "Related property history",
                detail: `${detail.propertyContext.records[0].listingName || "This property"} has ${detail.propertyContext.reservationCount} analyzed reservations in the current dataset.`,
                reservationId: detail.propertyContext.records[0].reservationId,
                phase: detail.propertyContext.records[0].bookingPhase,
            });
        }

        return evidence.slice(0, 6);
    }

    private truncate(value: string, maxLength: number) {
        const normalized = String(value || "").trim();
        if (normalized.length <= maxLength) return normalized;
        return `${normalized.slice(0, maxLength - 1)}…`;
    }

    private splitTags(value?: string | null) {
        return String(value || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }

    private calculateDaysLeft(departureDate?: string | Date | null) {
        if (!departureDate) return null;
        const target = new Date(departureDate);
        if (Number.isNaN(target.getTime())) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);
        return Math.ceil((target.getTime() - today.getTime()) / 86400000);
    }

    private async ensureSchema() {
        if (this.schemaReady) return;
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS reservation_ai_copilot_threads (
                id varchar(36) NOT NULL,
                reservationId int NOT NULL,
                name varchar(180) NOT NULL DEFAULT 'Reservation AI Copilot',
                isActive tinyint NOT NULL DEFAULT 1,
                lastRefreshedAt datetime NULL,
                createdBy varchar(255) NULL,
                createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY IDX_reservation_ai_copilot_threads_reservationId (reservationId),
                KEY IDX_reservation_ai_copilot_threads_isActive (isActive)
            )
        `);
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS reservation_ai_copilot_messages (
                id varchar(36) NOT NULL,
                threadId varchar(36) NOT NULL,
                reservationId int NOT NULL,
                role varchar(16) NOT NULL,
                content longtext NOT NULL,
                evidenceItems json NULL,
                contextMeta json NULL,
                createdBy varchar(255) NULL,
                createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY IDX_reservation_ai_copilot_messages_threadId (threadId),
                KEY IDX_reservation_ai_copilot_messages_reservationId (reservationId)
            )
        `);
        this.schemaReady = true;
    }
}
