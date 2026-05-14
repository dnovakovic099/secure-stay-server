import OpenAI from "openai";
import { Between, In } from "typeorm";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { appDatabase } from "../utils/database.util";
import { BookingPhase, GuestAnalysisEntity, GuestAnalysisFlag, GuestAnalysisTimelinePhase } from "../entity/GuestAnalysis";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { GuestCommunicationService } from "./GuestCommunicationService";
import { GuestAnalysisSettingsEntry } from "../entity/GuestAnalysisSettings";
import { GuestAnalysisSettingsService } from "./GuestAnalysisSettingsService";
import logger from "../utils/logger.utils";
import { v4 as uuidv4 } from "uuid";
import { Listing } from "../entity/Listing";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import sendSlackMessage from "../utils/sendSlackMsg";

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
    listingMapId: number | null;
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
    propertyType: string | null;
    serviceType: string | null;
    reservationDate: Date | string | null;
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
    flagPolarity?: Array<"positive" | "negative">;
    status?: string[];
    priority?: string[];
    property?: string[];
    propertyType?: string[];
    serviceType?: string[];
    dateType?: "arrivalDate" | "departureDate";
    arrivalDateFrom?: string;
    arrivalDateTo?: string;
    departureDateFrom?: string;
    departureDateTo?: string;
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

export interface GuestAnalysisDetailContext {
    record: GuestAnalysisRecord;
    phaseBreakdown: GuestAnalysisPhaseBreakdownItem[];
    reservationHistory: GuestAnalysisRecord[];
    propertyContext: {
        listingName: string | null;
        reservationCount: number;
        records: GuestAnalysisRecord[];
    };
    categoryContext: Array<{
        label: string;
        count: number;
        records: GuestAnalysisRecord[];
    }>;
    departmentContext: Array<{
        label: string;
        count: number;
        records: GuestAnalysisRecord[];
    }>;
}

export interface GuestAnalysisPhaseBreakdownItem {
    phase: GuestAnalysisTimelinePhase;
    label: string;
    summary: string;
    communicationCount: number;
    sentiment: SentimentType;
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

const PHASE_ORDER: BookingPhase[] = ["inquiry", "before_stay", "during_stay", "after_stay"];

/**
 * GuestAnalysisService
 * Generates AI-powered analysis of guest-host communications
 */
export class GuestAnalysisService {
    private openai: OpenAI;
    private analysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
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
        this.postAnalysisGeneratedToSlack(saved).catch((error) => {
            logger.error(`[GuestAnalysisService] Failed to post AI analysis Slack update for reservation ${reservationId}:`, error);
        });
        return saved;
    }

    private buildAnalysisGeneratedSlackText(analysis: GuestAnalysisEntity) {
        const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
        const greenFlags = flags.filter((flag: any) => flag?.polarity === "positive").length;
        const redFlags = flags.filter((flag: any) => flag?.polarity !== "positive").length;
        const sentimentReason = String(analysis.sentimentReason || "—").trim() || "—";

        return [
            "*AI ANALYSIS*",
            `*Green Flags:* ${greenFlags} | *Red Flags:* ${redFlags}`,
            "",
            `*👩🏻‍💻 Overall sentiment reason:* ${sentimentReason}`,
        ].join("\n");
    }

    private async postAnalysisGeneratedToSlack(analysis: GuestAnalysisEntity) {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({
            where: { reservationInfo: { id: Number(analysis.reservationId) } },
        });

        if (!reviewCheckout?.slackChannelId || !reviewCheckout?.slackThreadTs) {
            return;
        }

        await sendSlackMessage(
            {
                channel: reviewCheckout.slackChannelId,
                text: this.buildAnalysisGeneratedSlackText(analysis),
            },
            reviewCheckout.slackThreadTs
        );
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

    async getReservationPhaseBreakdown(reservationId: number): Promise<GuestAnalysisPhaseBreakdownItem[]> {
        const reservation = await this.reservationRepo.findOne({
            where: { id: reservationId }
        });
        const communications = await this.communicationService.getAllCommunicationsForReservation(reservationId);
        const grouped = this.groupCommunicationsByTimelinePhase(reservation, communications);
        const summaries = await this.generatePhaseBreakdownSummaries(grouped, reservation);

        return this.getTimelinePhaseOrder().map((phase) => ({
            phase,
            label: this.getTimelinePhaseLabel(phase),
            summary: summaries[phase]?.summary || "No guest communication captured during this phase.",
            communicationCount: grouped[phase].length,
            sentiment: summaries[phase]?.sentiment || "Neutral",
        }));
    }

    async getAnalysisDetailContext(reservationId: number): Promise<GuestAnalysisDetailContext | null> {
        const latestAnalyses = await this.getLatestAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = latestAnalyses.map(({ analysis, reservation, listing }) =>
            this.mapAnalysisRecord(analysis, reservation, listing, priorityRankMap, priorityStatusMap)
        );
        const currentRecord = mapped.find((record) => Number(record.reservationId) === Number(reservationId));
        if (!currentRecord) return null;
        const currentSource = latestAnalyses.find((item) => Number(item.analysis.reservationId) === Number(reservationId));

        const reservationHistory = (await this.getAllAnalysesByReservation(reservationId)).map((analysis) =>
            this.mapAnalysisRecord(
                analysis,
                currentSource?.reservation || null,
                currentSource?.listing || null,
                priorityRankMap,
                priorityStatusMap
            )
        );
        const phaseBreakdown = await this.getReservationPhaseBreakdown(reservationId);
        const propertyRecords = mapped
            .filter((record) => record.listingMapId && record.listingMapId === currentRecord.listingMapId && record.reservationId !== currentRecord.reservationId)
            .slice(0, 12);
        const categoryContext = currentRecord.categories.slice(0, 3).map((label) => ({
            label,
            count: mapped.filter((record) => record.categories.includes(label)).length,
            records: mapped.filter((record) => record.categories.includes(label) && record.reservationId !== currentRecord.reservationId).slice(0, 8),
        }));
        const departmentContext = currentRecord.departments.slice(0, 3).map((label) => ({
            label,
            count: mapped.filter((record) => record.departments.includes(label)).length,
            records: mapped.filter((record) => record.departments.includes(label) && record.reservationId !== currentRecord.reservationId).slice(0, 8),
        }));

        return {
            record: currentRecord,
            phaseBreakdown,
            reservationHistory,
            propertyContext: {
                listingName: currentRecord.listingName,
                reservationCount: mapped.filter((record) => record.listingMapId && record.listingMapId === currentRecord.listingMapId).length,
                records: propertyRecords,
            },
            categoryContext,
            departmentContext,
        };
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
        const analyses = await this.getAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = analyses.map(({ analysis, reservation, listing }) =>
            this.mapAnalysisRecord(analysis, reservation, listing, priorityRankMap, priorityStatusMap)
        );
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

    async getAllAnalysisRecords(filters: GuestAnalysisRecordFilters = {}): Promise<GuestAnalysisRecord[]> {
        const analyses = await this.getAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = analyses.map(({ analysis, reservation, listing }) =>
            this.mapAnalysisRecord(analysis, reservation, listing, priorityRankMap, priorityStatusMap)
        );
        const filtered = this.applyRecordFilters(mapped, filters);
        return this.sortRecords(filtered, priorityRankMap, filters.sortField, filters.sortDir || "DESC");
    }

    async getAnalysisSummary(filters: GuestAnalysisRecordFilters = {}): Promise<GuestAnalysisPhaseSummary[]> {
        const analyses = await this.getAnalysesWithReservations();
        const priorityRankMap = await this.settingsService.getPriorityRankMap();
        const priorityStatusMap = await this.settingsService.getPriorityStatusMap();
        const mapped = analyses.map(({ analysis, reservation, listing }) =>
            this.mapAnalysisRecord(analysis, reservation, listing, priorityRankMap, priorityStatusMap)
        );
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
     * Process scheduled AI analysis for reservations from the last 14 days
     * This is called by the daily scheduler at 10:00 AM EST
     */
    async processScheduledAnalysis(): Promise<{ processed: number; failed: number; skipped: number; }> {
        logger.info('[GuestAnalysisService] Scheduled analysis started - fetching last 14 days of checkouts...');

        const today = new Date();
        const fourteenDaysAgo = subDays(today, 14);

        const validStatus = ["new", "accepted", "modified", "ownerStay", "moved"];
        const reservations = await this.reservationRepo.find({
            where: {
                departureDate: Between(startOfDay(fourteenDaysAgo), endOfDay(today)),
                status: In(validStatus),
            },
            order: { departureDate: 'ASC' },
        });

        logger.info(`[GuestAnalysisService] Found ${reservations.length} checkout reservations in last 14 days to analyze`);

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

    private async getLatestAnalysesWithReservations(): Promise<Array<{ analysis: GuestAnalysisEntity; reservation: ReservationInfoEntity | null; listing: Listing | null }>> {
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
        const listingIds = Array.from(
            new Set(
                reservations
                    .map((reservation) => Number(reservation.listingMapId))
                    .filter((value) => Number.isFinite(value) && value > 0)
            )
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, select: ["id", "tags"] })
            : [];
        const listingMap = new Map<number, Listing>(
            listings.map((listing) => [Number(listing.id), listing])
        );

        return Array.from(latestByReservation.values()).map((analysis) => ({
            analysis,
            reservation: reservationMap.get(Number(analysis.reservationId)) || null,
            listing: listingMap.get(Number(reservationMap.get(Number(analysis.reservationId))?.listingMapId || 0)) || null,
        }));
    }

    private async getAnalysesWithReservations(): Promise<Array<{ analysis: GuestAnalysisEntity; reservation: ReservationInfoEntity | null; listing: Listing | null }>> {
        const analyses = await this.analysisRepo.find({ order: { analyzedAt: "DESC" } });
        const reservationIds = Array.from(new Set(analyses.map((analysis) => Number(analysis.reservationId)).filter((value) => Number.isFinite(value) && value > 0)));
        const reservations = reservationIds.length
            ? await this.reservationRepo.find({ where: { id: In(reservationIds) } })
            : [];
        const reservationMap = new Map<number, ReservationInfoEntity>(
            reservations.map((reservation) => [Number(reservation.id), reservation])
        );
        const listingIds = Array.from(
            new Set(
                reservations
                    .map((reservation) => Number(reservation.listingMapId))
                    .filter((value) => Number.isFinite(value) && value > 0)
            )
        );
        const listings = listingIds.length
            ? await this.listingRepo.find({ where: { id: In(listingIds) }, select: ["id", "tags"] })
            : [];
        const listingMap = new Map<number, Listing>(
            listings.map((listing) => [Number(listing.id), listing])
        );

        return analyses.map((analysis) => ({
            analysis,
            reservation: reservationMap.get(Number(analysis.reservationId)) || null,
            listing: listingMap.get(Number(reservationMap.get(Number(analysis.reservationId))?.listingMapId || 0)) || null,
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
        const bookingDate = this.resolveReservationConfirmationBoundary(reservation);
        const arrival = this.resolveStayBoundary(reservation.arrivalDate, reservation.checkInTime, 0);
        const departure = this.resolveStayBoundary(reservation.departureDate, reservation.checkOutTime, 23);

        if (bookingDate && reference < bookingDate) {
            return "inquiry";
        }
        if (arrival && reference < arrival) {
            return "before_stay";
        }

        if (departure) {
            if (reference >= departure) {
                return "after_stay";
            }
        }

        return "during_stay";
    }

    private mapAnalysisRecord(
        analysis: GuestAnalysisEntity,
        reservation: ReservationInfoEntity | null,
        listing: Listing | null,
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
            listingMapId: reservation?.listingMapId ? Number(reservation.listingMapId) : null,
            guestName: reservation?.guestName || null,
            listingName: reservation?.listingName || null,
            channelName: reservation?.channelName || reservation?.source || null,
            integration: reservation?.integration_nickname || null,
            confirmationCode: reservation?.confirmation_code || null,
            arrivalDate: reservation?.arrivalDate || null,
            departureDate: reservation?.departureDate || null,
            bookingPhase: this.resolveBookingPhase(reservation, [], analysis.analyzedAt),
            summary: analysis.summary,
            sentiment: analysis.sentiment as SentimentType,
            sentimentReason: analysis.sentimentReason,
            flags: this.normalizeFlagsForDisplay(analysis.flags || [], analysis.bookingPhase || this.resolveBookingPhase(reservation, [], analysis.analyzedAt)),
            analyzedAt: analysis.analyzedAt,
            analyzedBy: analysis.analyzedBy || null,
            propertyType: this.extractPropertyTypeFromTags(listing?.tags),
            serviceType: this.extractServiceTypeFromTags(listing?.tags),
            reservationDate: reservation?.reservationDate || null,
            categories,
            departments,
            flagCount: this.countNegativeFlags(analysis.flags || [], analysis.bookingPhase || this.resolveBookingPhase(reservation, [], analysis.analyzedAt)),
            priority,
            status,
        };
    }

    private countNegativeFlags(flags: GuestAnalysisFlag[], fallbackPhase?: BookingPhase): number {
        return this.normalizeFlagsForDisplay(flags, fallbackPhase).filter((flag) => flag.polarity !== "positive").length;
    }

    private normalizeFlagsForDisplay(flags: GuestAnalysisFlag[], fallbackPhase?: BookingPhase): GuestAnalysisFlag[] {
        return (flags || []).map((flag) => ({
            ...flag,
            polarity: flag?.polarity === "positive" ? "positive" : "negative",
            phases: this.normalizeFlagPhases(flag?.phases, fallbackPhase),
        }));
    }

    private normalizeFlagPhases(value: unknown, fallbackPhase?: BookingPhase): GuestAnalysisTimelinePhase[] {
        const allowed: GuestAnalysisTimelinePhase[] = ["inquiry", "before_stay", "during_stay", "after_stay"];
        const normalized = Array.isArray(value)
            ? value.map((item) => String(item || "").trim()).filter((item): item is GuestAnalysisTimelinePhase => allowed.includes(item as GuestAnalysisTimelinePhase))
            : [];
        if (normalized.length) {
            return Array.from(new Set(normalized));
        }
        if (fallbackPhase === "inquiry") return ["inquiry"];
        if (fallbackPhase === "after_stay") return ["after_stay"];
        return ["during_stay"];
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
        const selectedDateType = filters.dateType === "arrivalDate" ? "arrivalDate" : filters.dateType === "departureDate" ? "departureDate" : null;
        const arrivalDateFrom = this.parseDateFilter(filters.arrivalDateFrom, false);
        const arrivalDateTo = this.parseDateFilter(filters.arrivalDateTo, true);
        const departureDateFrom = this.parseDateFilter(filters.departureDateFrom, false);
        const departureDateTo = this.parseDateFilter(filters.departureDateTo, true);
        const activeDateFrom = selectedDateType === "departureDate" ? departureDateFrom : arrivalDateFrom;
        const activeDateTo = selectedDateType === "departureDate" ? departureDateTo : arrivalDateTo;

        return records.filter((record) => {
            if (filters.bookingPhase?.length && !filters.bookingPhase.includes(record.bookingPhase)) return false;
            if (filters.sentiment?.length && !filters.sentiment.includes(record.sentiment)) return false;
            if (filters.category?.length && !record.categories.some((category) => filters.category?.includes(category))) return false;
            if (filters.department?.length && !record.departments.some((department) => filters.department?.includes(department))) return false;
            if (filters.flagPolarity?.length) {
                const polarities = new Set((record.flags || []).map((flag) => flag.polarity || "negative"));
                if (!filters.flagPolarity.some((value) => polarities.has(value))) return false;
            }
            if (filters.status?.length && !filters.status.includes(record.status)) return false;
            if (filters.priority?.length && !filters.priority.includes(record.priority)) return false;
            if (filters.property?.length && !filters.property.includes(record.listingName || "")) return false;
            if (filters.propertyType?.length && !filters.propertyType.includes(record.propertyType || "")) return false;
            if (filters.serviceType?.length && !filters.serviceType.includes(record.serviceType || "")) return false;
            if (selectedDateType && (activeDateFrom || activeDateTo)) {
                const target = this.parseRecordDate(selectedDateType === "departureDate" ? record.departureDate : record.arrivalDate);
                if (!target) return false;
                if (activeDateFrom && target < activeDateFrom) return false;
                if (activeDateTo && target > activeDateTo) return false;
            }
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
                record.propertyType,
                record.serviceType,
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

    private extractPropertyTypeFromTags(tags: string | null | undefined): string | null {
        if (!tags) return null;
        const tagList = tags.split(',').map(t => t.trim().toLowerCase());
        if (tagList.includes('own')) return 'Own';
        if (tagList.includes('arb')) return 'Arb';
        if (tagList.includes('pm')) return 'PM';
        return null;
    }

    private extractServiceTypeFromTags(tags: string | null | undefined): string | null {
        if (!tags) return null;
        const tagList = tags.split(',').map(t => t.trim().toLowerCase());
        if (tagList.includes('full')) return 'Full';
        if (tagList.includes('pro')) return 'Pro';
        if (tagList.includes('launch')) return 'Launch';
        return null;
    }

    private parseRecordDate(value: Date | string | null | undefined): Date | null {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private parseDateFilter(value?: string, endOfDay = false): Date | null {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        if (endOfDay) {
            parsed.setHours(23, 59, 59, 999);
        } else {
            parsed.setHours(0, 0, 0, 0);
        }
        return parsed;
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
                    polarity: (String(flag.polarity || "").trim().toLowerCase() === "positive" ? "positive" : "negative") as "positive" | "negative",
                    phases: this.normalizeFlagPhases(flag.phases),
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

    private getTimelinePhaseOrder(): GuestAnalysisTimelinePhase[] {
        return ["inquiry", "before_stay", "during_stay", "after_stay"];
    }

    private getTimelinePhaseLabel(phase: GuestAnalysisTimelinePhase): string {
        switch (phase) {
            case "inquiry":
                return "Inquiry Phase";
            case "before_stay":
                return "Before Stay";
            case "during_stay":
                return "During Stay";
            case "after_stay":
                return "After Stay";
            default:
                return phase;
        }
    }

    private groupCommunicationsByTimelinePhase(
        reservation: ReservationInfoEntity | null,
        communications: GuestCommunicationEntity[],
    ): Record<GuestAnalysisTimelinePhase, GuestCommunicationEntity[]> {
        const grouped: Record<GuestAnalysisTimelinePhase, GuestCommunicationEntity[]> = {
            inquiry: [],
            before_stay: [],
            during_stay: [],
            after_stay: [],
        };
        const confirmationAt = this.resolveReservationConfirmationBoundary(reservation);
        const checkInAt = this.resolveStayBoundary(reservation?.arrivalDate, reservation?.checkInTime, 0);
        const checkOutAt = this.resolveStayBoundary(reservation?.departureDate, reservation?.checkOutTime, 23);

        communications.forEach((communication) => {
            const communicatedAt = new Date(communication.communicatedAt);
            if (confirmationAt && communicatedAt < confirmationAt) {
                grouped.inquiry.push(communication);
                return;
            }
            if (checkInAt && communicatedAt < checkInAt) {
                grouped.before_stay.push(communication);
                return;
            }
            if (checkOutAt && communicatedAt < checkOutAt) {
                grouped.during_stay.push(communication);
                return;
            }
            grouped.after_stay.push(communication);
        });

        if (!confirmationAt && !checkInAt && !checkOutAt && communications.length) {
            grouped.during_stay = [...communications];
        }

        return grouped;
    }

    private resolveReservationConfirmationBoundary(reservation: ReservationInfoEntity | null): Date | null {
        const raw = reservation?.reservationDate;
        if (!raw) return null;
        return this.parseDateValue(raw, 0);
    }

    private resolveStayBoundary(dateValue?: Date | string | null, hourValue?: number | null, fallbackHour = 0): Date | null {
        if (!dateValue) return null;
        const hour = Number.isFinite(Number(hourValue)) ? Number(hourValue) : fallbackHour;
        return this.parseDateValue(dateValue, hour);
    }

    private parseDateValue(value: Date | string, hour = 0): Date | null {
        if (!value) return null;
        if (value instanceof Date) {
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) return null;
            parsed.setHours(hour, 0, 0, 0);
            return parsed;
        }

        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnlyMatch) {
            const [, year, month, day] = dateOnlyMatch;
            return new Date(Number(year), Number(month) - 1, Number(day), hour, 0, 0, 0);
        }

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        parsed.setHours(hour, 0, 0, 0);
        return parsed;
    }

    private buildTimelineFromCommunications(communications: GuestCommunicationEntity[]): string {
        if (!communications.length) {
            return "No communications found for this phase.";
        }

        const lines: string[] = ["## Communication Timeline\n"];
        communications.forEach((comm) => {
            const timestamp = new Date(comm.communicatedAt).toISOString().replace("T", " ").substring(0, 19);
            const directionLabel = comm.direction === "inbound" ? "GUEST" : "REP";
            const sourceLabel = this.formatCommunicationSource(comm.source);
            lines.push(`[${timestamp}] [${sourceLabel}] [${directionLabel}] ${comm.senderName}:`);
            lines.push(comm.content);
            lines.push("");
        });
        return lines.join("\n");
    }

    private formatCommunicationSource(source: string): string {
        switch (source) {
            case "openphone_sms":
                return "SMS";
            case "openphone_call":
                return "CALL";
            case "hostify_message":
                return "MSG";
            default:
                return source.toUpperCase();
        }
    }

    private async generatePhaseBreakdownSummaries(
        grouped: Record<GuestAnalysisTimelinePhase, GuestCommunicationEntity[]>,
        reservation: ReservationInfoEntity | null,
    ): Promise<Record<GuestAnalysisTimelinePhase, { summary: string; sentiment: SentimentType }>> {
        const defaults: Record<GuestAnalysisTimelinePhase, { summary: string; sentiment: SentimentType }> = {
            inquiry: { summary: "No guest communication captured during this phase.", sentiment: "Neutral" },
            before_stay: { summary: "No guest communication captured during this phase.", sentiment: "Neutral" },
            during_stay: { summary: "No guest communication captured during this phase.", sentiment: "Neutral" },
            after_stay: { summary: "No guest communication captured during this phase.", sentiment: "Neutral" },
        };

        const hasAnyCommunication = this.getTimelinePhaseOrder().some((phase) => grouped[phase].length > 0);
        if (!hasAnyCommunication) {
            return defaults;
        }

        const systemPrompt = `You are an expert hospitality communication analyst for a vacation rental management company.

Your task is to summarize guest communication across four reservation phases:
- inquiry
- before_stay
- during_stay
- after_stay

Return valid JSON with exactly these keys:
{
  "inquiry": { "summary": "summary", "sentiment": "Positive|Neutral|Negative|Mixed" },
  "before_stay": { "summary": "summary", "sentiment": "Positive|Neutral|Negative|Mixed" },
  "during_stay": { "summary": "summary", "sentiment": "Positive|Neutral|Negative|Mixed" },
  "after_stay": { "summary": "summary", "sentiment": "Positive|Neutral|Negative|Mixed" }
}

Rules:
- Each summary must be concise, neutral, and operationally useful.
- Focus on guest concerns, team actions, outcomes, and unresolved items.
- Do not invent facts.
- If a phase has no messages, return exactly: "No guest communication captured during this phase."
- Keep each phase summary to 1-3 sentences.`;

        const phaseSections = this.getTimelinePhaseOrder()
            .map((phase) => `### ${phase}\n${this.buildTimelineFromCommunications(grouped[phase])}`)
            .join("\n\n");

        const userPrompt = [
            "## Reservation Context",
            `- Guest Name: ${reservation?.guestName || "Unknown"}`,
            `- Listing: ${reservation?.listingName || "Unknown"}`,
            `- Booking Date: ${reservation?.reservationDate || "Unknown"}`,
            `- Check-in Date: ${reservation?.arrivalDate || "Unknown"}`,
            `- Check-out Date: ${reservation?.departureDate || "Unknown"}`,
            "",
            "## Phase Timelines",
            phaseSections,
            "",
            "Summarize each phase in JSON."
        ].join("\n");

        let content = "";
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                temperature: 0.2,
                response_format: { type: "json_object" }
            });
            content = response.choices[0]?.message?.content || "";
        } catch (error: any) {
            logger.error("[GuestAnalysisService] Error generating phase breakdown:", error?.message || error);
            return defaults;
        }

        if (!content) {
            return defaults;
        }

        try {
            const parsed = JSON.parse(content) as Partial<Record<GuestAnalysisTimelinePhase, { summary?: string; sentiment?: string } | string>>;
            return this.getTimelinePhaseOrder().reduce<Record<GuestAnalysisTimelinePhase, { summary: string; sentiment: SentimentType }>>((accumulator, phase) => {
                const rawPhase = parsed?.[phase];
                if (typeof rawPhase === "string") {
                    accumulator[phase] = { summary: rawPhase.trim() || defaults[phase].summary, sentiment: "Neutral" };
                    return accumulator;
                }
                const summary = String((rawPhase as any)?.summary || "").trim();
                const sentiment = String((rawPhase as any)?.sentiment || "").trim();
                accumulator[phase] = {
                    summary: summary || defaults[phase].summary,
                    sentiment: ["Positive", "Neutral", "Negative", "Mixed"].includes(sentiment) ? (sentiment as SentimentType) : defaults[phase].sentiment,
                };
                return accumulator;
            }, { ...defaults });
        } catch (error: any) {
            logger.error("[GuestAnalysisService] Error parsing phase breakdown response:", error?.message || error, { content });
            return defaults;
        }
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
            "polarity": "positive | negative",
            "phases": ["inquiry | before_stay | during_stay | after_stay"],
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
- Flags can be negative problems or positive operational wins
- Use polarity "negative" for complaints, failures, confusion, missed expectations, escalation risk, unresolved issues
- Use polarity "positive" for strong service recovery, proactive communication, fast execution, clear coordination, or guest praise tied to operations
- If multiple issues or wins exist, list them all, most important first
- Prioritize "Property / Unit Issue" whenever there is a real property problem
- If something was supposed to be done but wasn't, prefer "Execution Failure"
- If information was wrong or conflicting, use "Information Problem"
- Focus on the operational problem, not just emotion
- Do not guess or invent facts
- For each flag, include every applicable phase in "phases". If the same topic spans multiple phases, include all of them.
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
