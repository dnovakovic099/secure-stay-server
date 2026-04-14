import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { BookingPhase, GuestAnalysisEntity, GuestAnalysisFlag } from "../entity/GuestAnalysis";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { GuestCommunicationService } from "./GuestCommunicationService";
import { GuestAnalysisSettingsEntry } from "../entity/GuestAnalysisSettings";
import { GuestAnalysisSettingsService } from "./GuestAnalysisSettingsService";
import logger from "../utils/logger.utils";
import { v4 as uuidv4 } from "uuid";

/**
 * Sentiment types for guest analysis
 */
export type SentimentType = "Positive" | "Neutral" | "Negative" | "Mixed";

export const FLAG_ROOT_CAUSES = [
    "Staffing problem",
    "Training problem",
    "Bad process / SOP",
    "Vendor didn't show up",
    "System/tool issue",
    "Too much workload",
    "Not enough maintenance",
    "Unknown"
] as const;

export type AnalysisStatus = "No issue" | "Monitor" | "Action needed";

export interface GuestAnalysisRecord {
    id: string;
    reservationId: number;
    guestName: string | null;
    listingName: string | null;
    channelName: string | null;
    integration: string | null;
    confirmationCode: string | null;
    arrivalDate: Date | string | null;
    departureDate: Date | string | null;
    bookingPhase: BookingPhase;
    summary: string;
    sentiment: SentimentType;
    sentimentReason: string;
    flags: GuestAnalysisFlag[];
    analyzedAt: Date;
    analyzedBy: string | null;
    categories: string[];
    departments: string[];
    flagCount: number;
    priority: string;
    status: AnalysisStatus;
}

export interface GuestAnalysisRecordFilters {
    search?: string;
    bookingPhase?: BookingPhase[];
    sentiment?: string[];
    category?: string[];
    department?: string[];
    status?: string[];
    priority?: string[];
    sortField?: string;
    sortDir?: "ASC" | "DESC";
    page?: number;
    limit?: number;
}

export interface GuestAnalysisPhaseSummary {
    bookingPhase: BookingPhase;
    total: number;
    topCategory: { label: string; count: number } | null;
    topDepartment: { label: string; count: number } | null;
    byCategory: Array<{ label: string; count: number }>;
    byDepartment: Array<{ label: string; count: number }>;
    byStatus: Array<{ label: string; count: number }>;
    byPriority: Array<{ label: string; count: number }>;
}

/**
 * AI analysis result interface
 */
export interface GuestAnalysisResult {
    summary: string;
    sentiment: SentimentType;
    sentimentReason: string;
    flags: GuestAnalysisFlag[];
}

const PHASE_ORDER: BookingPhase[] = ["inquiry", "during_stay", "after_stay"];

/**
 * GuestAnalysisService
 * Generates AI-powered analysis of guest-host communications
 */
export class GuestAnalysisService {
    private openai: OpenAI;
    private analysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private communicationService: GuestCommunicationService;
    private settingsService: GuestAnalysisSettingsService;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
        this.communicationService = new GuestCommunicationService();
        this.settingsService = new GuestAnalysisSettingsService();
    }

    /**
     * Analyze guest communications for a reservation
     * Fetches data from all sources and generates AI analysis
     */
    async analyzeGuestCommunication(
        reservationId: number,
        inboxId?: string,
        triggeredBy: string = "manual"
    ): Promise<GuestAnalysisEntity> {
        logger.info(`[GuestAnalysisService] Starting analysis for reservation ${reservationId}`);

        // Fetch communications from OpenPhone
        await this.communicationService.fetchAndStoreFromOpenPhone(reservationId);

        // Fetch communications from Hostify (inboxId will be discovered if not provided)
        await this.communicationService.fetchAndStoreFromHostify(reservationId, inboxId);

        // Build timeline for AI
        const timeline = await this.communicationService.buildCommunicationTimeline(reservationId);

        // Get reservation info for context
        const reservation = await this.reservationRepo.findOne({
            where: { id: reservationId }
        });

        // Get communication IDs
        const communications = await this.communicationService.getAllCommunicationsForReservation(reservationId);
        const communicationIds = communications.map(c => c.id);
        const bookingPhase = this.resolveBookingPhase(reservation, communications);

        // Generate AI analysis
        const result = await this.generateAnalysis(timeline, reservation);

        // Always create a new record to preserve full history
        const analysis = this.analysisRepo.create({
            id: uuidv4(),
            reservationId,
            summary: result.summary,
            sentiment: result.sentiment,
            sentimentReason: result.sentimentReason,
            flags: result.flags,
            analyzedAt: new Date(),
            analyzedBy: triggeredBy,
            bookingPhase,
            communicationIds
        });

        const saved = await this.analysisRepo.save(analysis);
        logger.info(`[GuestAnalysisService] Analysis saved for reservation ${reservationId}`);
        return saved;
    }

    /**
     * Get the latest analysis for a reservation
     */
    async getAnalysisByReservation(reservationId: number): Promise<GuestAnalysisEntity | null> {
        return this.analysisRepo.findOne({
            where: { reservationId },
            order: { analyzedAt: 'DESC' }
        });
    }

    /**
     * Get all analyses for a reservation, newest first (full history)
     */
    async getAllAnalysesByReservation(reservationId: number): Promise<GuestAnalysisEntity[]> {
        return this.analysisRepo.find({
            where: { reservationId },
            order: { analyzedAt: 'DESC' }
        });
    }

    /**
     * Get latest analysis per reservation for a list of reservation IDs
     */
    async getAnalysesByReservations(reservationIds: number[]): Promise<GuestAnalysisEntity[]> {
        if (reservationIds.length === 0) return [];
        const all = await this.analysisRepo.find({
            where: { reservationId: In(reservationIds) },
            order: { analyzedAt: 'DESC' }
        });
        // Deduplicate: keep latest per reservationId
        const seen = new Set<number>();
        return all.filter(a => {
            if (seen.has(a.reservationId)) return false;
            seen.add(a.reservationId);
            return true;
        });
    }

    /**
     * Regenerate analysis for a reservation
     */
    async regenerateAnalysis(reservationId: number, inboxId?: string): Promise<GuestAnalysisEntity> {
        return this.analyzeGuestCommunication(reservationId, inboxId);
    }

    async getAnalysisRecords(filters: GuestAnalysisRecordFilters = {}): Promise<{
        result: GuestAnalysisRecord[];
        total: number;
        page: number;
        limit: number;
    }> {
        const latestAnalyses = await this.getLatestAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = latestAnalyses.map(({ analysis, reservation }) => this.mapAnalysisRecord(analysis, reservation, priorityRankMap, priorityStatusMap));
        const filtered = this.applyRecordFilters(mapped, filters);
        const sorted = this.sortRecords(filtered, priorityRankMap, filters.sortField, filters.sortDir || "DESC");
        const page = Math.max(1, Number(filters.page || 1));
        const limit = Math.max(1, Number(filters.limit || 25));
        const start = (page - 1) * limit;

        return {
            result: sorted.slice(start, start + limit),
            total: sorted.length,
            page,
            limit,
        };
    }

    async getAnalysisSummary(filters: GuestAnalysisRecordFilters = {}): Promise<GuestAnalysisPhaseSummary[]> {
        const latestAnalyses = await this.getLatestAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = latestAnalyses.map(({ analysis, reservation }) => this.mapAnalysisRecord(analysis, reservation, priorityRankMap, priorityStatusMap));
        const filtered = this.applyRecordFilters(mapped, filters);

        return PHASE_ORDER.map((phase) => {
            const phaseRecords = filtered.filter((record) => record.bookingPhase === phase);
            const byCategory = this.buildCountList(phaseRecords.flatMap((record) => record.categories));
            const byDepartment = this.buildCountList(phaseRecords.flatMap((record) => record.departments));
            const byStatus = this.buildCountList(phaseRecords.map((record) => record.status));
            const byPriority = this.buildCountList(phaseRecords.map((record) => record.priority));

            return {
                bookingPhase: phase,
                total: phaseRecords.length,
                topCategory: byCategory[0] || null,
                topDepartment: byDepartment[0] || null,
                byCategory,
                byDepartment,
                byStatus,
                byPriority,
            };
        });
    }

    /**
     * Process scheduled AI analysis for today's checkout reservations
     * This is called by the daily scheduler at 6:15 AM EST
     */
    async processScheduledAnalysis(): Promise<{ processed: number; failed: number; skipped: number; }> {
        const { ReservationInfoService } = await import('./ReservationInfoService');
        const reservationInfoService = new ReservationInfoService();

        logger.info('[GuestAnalysisService] Scheduled analysis started - fetching today\'s checkouts...');

        const { reservations } = await reservationInfoService.getCheckoutReservations();
        logger.info(`[GuestAnalysisService] Found ${reservations.length} checkout reservations to analyze`);

        let processed = 0;
        let failed = 0;
        let skipped = 0;

        for (const reservation of reservations) {
            try {
                // Check if analysis already exists and was done recently (within last 24 hours)
                const existing = await this.getAnalysisByReservation(reservation.id);
                if (existing && existing.analyzedAt) {
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    if (existing.analyzedAt > twentyFourHoursAgo) {
                        logger.info(`[GuestAnalysisService] Skipping reservation ${reservation.id} - recent analysis exists`);
                        skipped++;
                        continue;
                    }
                }

                logger.info(`[GuestAnalysisService] Processing reservation ${reservation.id} (${reservation.guestName})`);
                await this.analyzeGuestCommunication(reservation.id, undefined, "auto");
                processed++;
            } catch (error: any) {
                logger.error(`[GuestAnalysisService] Failed to analyze reservation ${reservation.id}: ${error.message}`);
                failed++;
            }
        }

        logger.info(`[GuestAnalysisService] Scheduled analysis complete - Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`);
        return { processed, failed, skipped };
    }

    private async getLatestAnalysesWithReservations(): Promise<Array<{ analysis: GuestAnalysisEntity; reservation: ReservationInfoEntity | null }>> {
        const all = await this.analysisRepo.find({ order: { analyzedAt: "DESC" } });
        const latestByReservation = new Map<number, GuestAnalysisEntity>();

        all.forEach((analysis) => {
            if (!latestByReservation.has(analysis.reservationId)) {
                latestByReservation.set(analysis.reservationId, analysis);
            }
        });

        const reservationIds = Array.from(latestByReservation.keys());
        const reservations = reservationIds.length
            ? await this.reservationRepo.find({ where: { id: In(reservationIds) } })
            : [];
        const reservationMap = new Map<number, ReservationInfoEntity>(
            reservations.map((reservation) => [Number(reservation.id), reservation])
        );

        return Array.from(latestByReservation.values()).map((analysis) => ({
            analysis,
            reservation: reservationMap.get(Number(analysis.reservationId)) || null,
        }));
    }

    private resolveBookingPhase(
        reservation: ReservationInfoEntity | null,
        communications: GuestCommunicationEntity[] = [],
        fallbackDate?: Date | null,
    ): BookingPhase {
        if (!reservation) return "during_stay";

        const guestInbound = [...communications]
            .filter((communication) => communication.direction === "inbound")
            .sort((a, b) => new Date(b.communicatedAt).getTime() - new Date(a.communicatedAt).getTime());
        const referenceDate = guestInbound[0]?.communicatedAt || communications[communications.length - 1]?.communicatedAt || fallbackDate || new Date();
        const reference = new Date(referenceDate);
        const arrival = reservation.arrivalDate ? new Date(reservation.arrivalDate) : null;
        const departure = reservation.departureDate ? new Date(reservation.departureDate) : null;

        if (arrival && reference < new Date(arrival.toISOString().slice(0, 10))) {
            return "inquiry";
        }

        if (departure) {
            const departureEnd = new Date(departure.toISOString().slice(0, 10));
            departureEnd.setDate(departureEnd.getDate() + 1);
            if (reference >= departureEnd) {
                return "after_stay";
            }
        }

        return "during_stay";
    }

    private mapAnalysisRecord(
        analysis: GuestAnalysisEntity,
        reservation: ReservationInfoEntity | null,
        priorityRankMap: Map<string, number>,
        priorityStatusMap: Map<string, AnalysisStatus>,
    ): GuestAnalysisRecord {
        const categories = Array.from(new Set((analysis.flags || []).map((flag) => flag.flag).filter(Boolean)));
        const departments = Array.from(new Set((analysis.flags || []).map((flag) => flag.owner).filter(Boolean) as string[]));
        const priority = this.getPriorityFromFlags(analysis.flags || [], priorityRankMap);
        const status = this.getStatusFromFlags(analysis.flags || [], priorityRankMap, priorityStatusMap);

        return {
            id: analysis.id,
            reservationId: Number(analysis.reservationId),
            guestName: reservation?.guestName || null,
            listingName: reservation?.listingName || null,
            channelName: reservation?.channelName || reservation?.source || null,
            integration: reservation?.integration_nickname || null,
            confirmationCode: reservation?.confirmation_code || null,
            arrivalDate: reservation?.arrivalDate || null,
            departureDate: reservation?.departureDate || null,
            bookingPhase: analysis.bookingPhase || this.resolveBookingPhase(reservation, [], analysis.analyzedAt),
            summary: analysis.summary,
            sentiment: analysis.sentiment as SentimentType,
            sentimentReason: analysis.sentimentReason,
            flags: analysis.flags || [],
            analyzedAt: analysis.analyzedAt,
            analyzedBy: analysis.analyzedBy || null,
            categories,
            departments,
            flagCount: analysis.flags?.length || 0,
            priority,
            status,
        };
    }

    private getPriorityFromFlags(flags: GuestAnalysisFlag[], priorityRankMap: Map<string, number>): string {
        if (!flags.length) return "None";
        return [...flags]
            .sort((left, right) => (priorityRankMap.get(right.severity || "") || 0) - (priorityRankMap.get(left.severity || "") || 0))[0]
            ?.severity || "None";
    }

    private getStatusFromFlags(
        flags: GuestAnalysisFlag[],
        priorityRankMap: Map<string, number>,
        priorityStatusMap: Map<string, AnalysisStatus>,
    ): AnalysisStatus {
        if (!flags.length) return "No issue";
        const highest = this.getPriorityFromFlags(flags, priorityRankMap);
        return priorityStatusMap.get(highest) || "Monitor";
    }

    private applyRecordFilters(records: GuestAnalysisRecord[], filters: GuestAnalysisRecordFilters): GuestAnalysisRecord[] {
        const keyword = String(filters.search || "").trim().toLowerCase();

        return records.filter((record) => {
            if (filters.bookingPhase?.length && !filters.bookingPhase.includes(record.bookingPhase)) return false;
            if (filters.sentiment?.length && !filters.sentiment.includes(record.sentiment)) return false;
            if (filters.category?.length && !record.categories.some((category) => filters.category?.includes(category))) return false;
            if (filters.department?.length && !record.departments.some((department) => filters.department?.includes(department))) return false;
            if (filters.status?.length && !filters.status.includes(record.status)) return false;
            if (filters.priority?.length && !filters.priority.includes(record.priority)) return false;
            if (!keyword) return true;

            const haystack = [
                record.summary,
                record.sentiment,
                record.sentimentReason,
                record.guestName,
                record.listingName,
                record.channelName,
                record.integration,
                record.confirmationCode,
                record.bookingPhase,
                record.priority,
                record.status,
                ...record.categories,
                ...record.departments,
                ...(record.flags || []).flatMap((flag) => [flag.flag, flag.explanation, flag.owner, flag.rootCause, flag.evidence]),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return haystack.includes(keyword);
        });
    }

    private sortRecords(
        records: GuestAnalysisRecord[],
        priorityRankMap: Map<string, number>,
        sortField?: string,
        sortDir: "ASC" | "DESC" = "DESC",
    ): GuestAnalysisRecord[] {
        const direction = sortDir === "ASC" ? 1 : -1;
        const field = sortField || "analyzedAt";

        return [...records].sort((left, right) => {
            const leftValue = this.getSortValue(left, field, priorityRankMap);
            const rightValue = this.getSortValue(right, field, priorityRankMap);
            if (leftValue === rightValue) return 0;
            if (leftValue > rightValue) return direction;
            return -1 * direction;
        });
    }

    private getSortValue(record: GuestAnalysisRecord, field: string, priorityRankMap: Map<string, number>): string | number {
        switch (field) {
            case "guestName":
                return (record.guestName || "").toLowerCase();
            case "listingName":
                return (record.listingName || "").toLowerCase();
            case "bookingPhase":
                return PHASE_ORDER.indexOf(record.bookingPhase);
            case "priority":
                return priorityRankMap.get(record.priority) || 0;
            case "status":
                return record.status;
            case "flagCount":
                return record.flagCount;
            default:
                return new Date(record.analyzedAt).getTime();
        }
    }

    private buildCountList(values: Array<string | null | undefined>): Array<{ label: string; count: number }> {
        const counts = new Map<string, number>();
        values.filter(Boolean).forEach((value) => {
            const label = String(value);
            counts.set(label, (counts.get(label) || 0) + 1);
        });
        return Array.from(counts.entries())
            .map(([label, count]) => ({ label, count }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    }

    /**
     * Generate AI analysis from communication timeline
     */
    private async generateAnalysis(
        timeline: string,
        reservation: ReservationInfoEntity | null
    ): Promise<GuestAnalysisResult> {
        const [categories, departments, priorities] = await Promise.all([
            this.settingsService.getActiveSectionItems("categories"),
            this.settingsService.getActiveSectionItems("departments"),
            this.settingsService.getActiveSectionItems("priorities"),
        ]);

        const systemPrompt = this.buildSystemPrompt(categories, departments, priorities);
        const userPrompt = this.buildUserPrompt(timeline, reservation);

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        try {
            const parsed = this.parseAnalysisResponse(content);

            if (!["Positive", "Neutral", "Negative", "Mixed"].includes(parsed.sentiment)) {
                parsed.sentiment = "Neutral";
            }
            if (!parsed.summary?.trim()) {
                parsed.summary = "No clear guest communication summary was generated.";
            }
            if (!parsed.sentimentReason?.trim()) {
                parsed.sentimentReason = "Sentiment defaulted because the AI response did not include a valid reason.";
            }

            if (!Array.isArray(parsed.flags)) {
                parsed.flags = [];
            }
            const categoryNames = new Set(categories.map((entry) => entry.name));
            const departmentNames = new Set(departments.map((entry) => entry.name));
            const priorityNames = new Set(priorities.map((entry) => entry.name));
            const fallbackCategory = categories[0]?.name || "Issue";
            const fallbackDepartment = departments[0]?.name || "Operations";
            const fallbackPriority = priorities[0]?.name || "Medium";

            parsed.flags = parsed.flags
                .filter((flag: any) => flag && typeof flag === "object")
                .map((flag: any) => ({
                    flag: categoryNames.has(flag.flag) ? flag.flag : fallbackCategory,
                    explanation: String(flag.explanation || "").trim(),
                    owner: departmentNames.has(flag.owner) ? flag.owner : fallbackDepartment,
                    rootCause: FLAG_ROOT_CAUSES.includes(flag.rootCause) ? flag.rootCause : "Unknown",
                    severity: priorityNames.has(flag.severity) ? flag.severity : fallbackPriority,
                    evidence: String(flag.evidence || "").trim(),
                    evidenceAt: String(flag.evidenceAt || "").trim() || undefined,
                }))
                .filter((flag: any) => flag.explanation);

            return parsed;
        } catch (error: any) {
            logger.error("[GuestAnalysisService] Error parsing AI response:", error?.message || error, { content });
            throw new Error("AI returned an invalid analysis payload");
        }
    }


    private parseAnalysisResponse(content: string): GuestAnalysisResult {
        const candidates = [content];
        const trimmed = content.trim();

        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) candidates.push(fenced[1]);

        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
        }

        for (const candidate of candidates) {
            try {
                return JSON.parse(candidate) as GuestAnalysisResult;
            } catch {
                // try next candidate
            }
        }

        throw new Error('Unable to parse AI JSON response');
    }

    /**
     * Build system prompt for AI analysis
     */
    private buildSettingsPromptBlock(title: string, items: GuestAnalysisSettingsEntry[], valueFieldLabel = "Use only these values") {
        const lines = [`## ${title.toUpperCase()}`, valueFieldLabel];
        items.forEach((item) => {
            lines.push(`- ${item.name}: ${item.criteria}`);
        });
        return lines.join("\n");
    }

    private buildSystemPrompt(
        categories: GuestAnalysisSettingsEntry[],
        departments: GuestAnalysisSettingsEntry[],
        priorities: GuestAnalysisSettingsEntry[],
    ): string {
        const categoryList = categories.map((item) => item.name).join(" | ");
        const departmentList = departments.map((item) => item.name).join(" | ");
        const priorityList = priorities.map((item) => item.name).join(" | ");
        return `You are an expert hospitality communication analyst for a vacation rental management company. Your role is to analyze guest-host communication data and produce structured internal insights.

## YOUR TASK
Analyze the provided guest communication timeline and generate:
1. An AI-generated interaction summary
2. An overall standardized sentiment
3. Operational flags highlighting issues

## OUTPUT FORMAT
Respond in valid JSON with this structure:
{
    "summary": "Concise, neutral summary covering guest concerns, rep actions, outcomes, escalations",
    "sentiment": "Positive" | "Neutral" | "Negative" | "Mixed",
    "sentimentReason": "1-2 line explanation of sentiment classification",
    "flags": [
        {
            "flag": "${categoryList}",
            "explanation": "One sentence explaining exactly what went wrong",
            "owner": "${departmentList}",
            "rootCause": "Staffing problem | Training problem | Bad process / SOP | Vendor didn't show up | System/tool issue | Too much workload | Not enough maintenance | Unknown",
            "severity": "${priorityList}",
            "evidence": "Short quote or paraphrase from the communication/review",
            "evidenceAt": "Exact timestamp from the communication timeline when the guest said this, if available"
        }
    ]
}

## SUMMARY RULES
- Be concise and neutral
- Cover: guest concerns, rep actions, outcomes, escalations
- Do NOT add assumptions
- Do NOT repeat message content verbatim
- Do NOT include internal system names

## SENTIMENT LABELS (use exactly one)
- Positive: Guest expressed satisfaction, gratitude, or resolved issues happily
- Neutral: Standard transactional communication without strong emotion
- Negative: Guest expressed frustration, complaints, or dissatisfaction
- Mixed: Communication contains both positive and negative elements

## WHAT TO DO
- Decide if there is a real operational issue or not
- If no issue is present, return empty flags array: []
- If multiple issues exist, list them all, most important first
- Prioritize "Property / Unit Issue" whenever there is a real property problem
- If something was supposed to be done but wasn't, prefer "Execution Failure"
- If information was wrong or conflicting, use "Information Problem"
- Focus on the operational problem, not just emotion
- Do not guess or invent facts
- When you cite evidence from a guest message, include the guest message timestamp in evidenceAt when it is available in the timeline

${this.buildSettingsPromptBlock("Categories", categories)}

## ROOT CAUSE (pick the best fit)
- Staffing problem
- Training problem
- Bad process / SOP
- Vendor didn't show up
- System/tool issue
- Too much workload
- Not enough maintenance
- Unknown

${this.buildSettingsPromptBlock("Departments", departments, "Assign the primary department/team using only these values")}

${this.buildSettingsPromptBlock("Priority", priorities, "Assign the issue priority using only these values")}

If no issues found, return empty flags array: []`;
    }

    /**
     * Build user prompt with timeline and context
     */
    private buildUserPrompt(timeline: string, reservation: ReservationInfoEntity | null): string {
        let prompt = "## GUEST COMMUNICATION DATA\n\n";

        if (reservation) {
            prompt += "### Reservation Context\n";
            prompt += `- Guest Name: ${reservation.guestName || "Unknown"}\n`;
            prompt += `- Listing: ${reservation.listingName || "Unknown"}\n`;
            prompt += `- Check-in: ${reservation.arrivalDate || "Unknown"}\n`;
            prompt += `- Check-out: ${reservation.departureDate || "Unknown"}\n`;
            prompt += `- Channel: ${reservation.channelName || "Unknown"}\n\n`;
        }

        prompt += timeline;
        prompt += "\n\n## INSTRUCTIONS\nAnalyze the above communication timeline and provide the JSON analysis. Include only issues that are supported by the actual communication data.";

        return prompt;
    }
}
