import { Request, Response } from "express";
import { GuestAnalysisService } from "../services/GuestAnalysisService";
import { GuestCommunicationService } from "../services/GuestCommunicationService";
import { GuestAnalysisSettingsService } from "../services/GuestAnalysisSettingsService";
import { GuestAnalysisReportThreadService } from "../services/GuestAnalysisReportThreadService";
import logger from "../utils/logger.utils";
import type { GuestAnalysisRecordFilters } from "../services/GuestAnalysisService";
import type { GuestAnalysisMigrationPlan, GuestAnalysisSettingsValue } from "../entity/GuestAnalysisSettings";

/**
 * GuestAnalysisController
 * Handles API endpoints for guest communication analysis
 */
export class GuestAnalysisController {
    private analysisService: GuestAnalysisService;
    private communicationService: GuestCommunicationService;
    private settingsService: GuestAnalysisSettingsService;
    private reportThreadService: GuestAnalysisReportThreadService;

    constructor() {
        this.analysisService = new GuestAnalysisService();
        this.communicationService = new GuestCommunicationService();
        this.settingsService = new GuestAnalysisSettingsService();
        this.reportThreadService = new GuestAnalysisReportThreadService();
    }

    /**
     * GET /api/guest-analysis/:reservationId
     * Get existing analysis for a reservation
     */
    getAnalysis = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const analysis = await this.analysisService.getAnalysisByReservation(reservationId);
            if (!analysis) {
                res.status(404).json({ error: "No analysis found for this reservation" });
                return;
            }

            res.json({
                success: true,
                data: analysis
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getAnalysis error:", error.message);
            res.status(500).json({ error: "Failed to get analysis" });
        }
    };

    /**
     * GET /api/guest-analysis/bulk
     * Get existing analyses for multiple reservations
     */
    getBulkAnalyses = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationIdsStr = req.query.reservationIds as string;
            if (!reservationIdsStr) {
                res.status(400).json({ error: "Missing reservationIds query parameter" });
                return;
            }

            const reservationIds = reservationIdsStr.split(",").map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            if (reservationIds.length === 0) {
                res.status(400).json({ error: "Invalid reservation IDs" });
                return;
            }

            const analyses = await this.analysisService.getAnalysesByReservations(reservationIds);

            res.json({
                success: true,
                data: analyses
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getBulkAnalyses error:", error.message);
            res.status(500).json({ error: "Failed to get bulk analyses" });
        }
    };

    getSummary = async (req: Request, res: Response): Promise<void> => {
        try {
            const filters = this.buildRecordFilters(req);
            const summary = await this.analysisService.getAnalysisSummary(filters);
            res.json({ success: true, data: summary });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getSummary error:", error.message);
            res.status(500).json({ error: "Failed to get analysis summary" });
        }
    };

    getRecords = async (req: Request, res: Response): Promise<void> => {
        try {
            const filters = this.buildRecordFilters(req);
            const records = await this.analysisService.getAnalysisRecords(filters);
            res.json({ success: true, data: records });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getRecords error:", error.message);
            res.status(500).json({ error: "Failed to get analysis records" });
        }
    };

    getSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const settings = await this.settingsService.getSettings();
            res.json({ success: true, data: settings });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getSettings error:", error.message);
            res.status(500).json({ error: "Failed to get AI analysis settings" });
        }
    };

    updateSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            const value = req.body?.value as GuestAnalysisSettingsValue | undefined;
            const migrationPlan = (req.body?.migrationPlan || null) as GuestAnalysisMigrationPlan | null;
            if (!value) {
                res.status(400).json({ error: "Missing settings payload" });
                return;
            }

            const settings = await this.settingsService.updateSettings(value, migrationPlan, userId);
            res.json({ success: true, data: settings });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] updateSettings error:", error.message);
            res.status(400).json({ error: error?.message || "Failed to update AI analysis settings" });
        }
    };

    listReportThreads = async (req: Request, res: Response): Promise<void> => {
        try {
            const threads = await this.reportThreadService.listThreads();
            res.json({ success: true, data: threads });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] listReportThreads error:", error.message);
            res.status(500).json({ error: "Failed to load report threads" });
        }
    };

    createReportThread = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user?.id || null;
            const thread = await this.reportThreadService.createThread({
                name: req.body?.name,
                initialPrompt: req.body?.initialPrompt,
                filters: req.body?.filters || {},
                userId,
            });
            res.json({ success: true, data: thread });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] createReportThread error:", error.message);
            res.status(400).json({ error: error?.message || "Failed to create report thread" });
        }
    };

    getReportThread = async (req: Request, res: Response): Promise<void> => {
        try {
            const thread = await this.reportThreadService.getThread(String(req.params.threadId));
            res.json({ success: true, data: thread });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getReportThread error:", error.message);
            res.status(404).json({ error: error?.message || "Report thread not found" });
        }
    };

    createReportThreadMessage = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = (req as any).user?.id || null;
            const thread = await this.reportThreadService.addMessage(String(req.params.threadId), {
                content: req.body?.content,
                filters: req.body?.filters || {},
                userId,
            });
            res.json({ success: true, data: thread });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] createReportThreadMessage error:", error.message);
            res.status(400).json({ error: error?.message || "Failed to create report thread message" });
        }
    };


    /**
     * POST /api/guest-analysis/:reservationId/generate
     * Generate new analysis for a reservation
     */
    generateAnalysis = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const { inboxId } = req.body;

            logger.info(`[GuestAnalysisController] Generating analysis for reservation ${reservationId}`);
            const analysis = await this.analysisService.analyzeGuestCommunication(reservationId, inboxId);

            res.json({
                success: true,
                data: analysis
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] generateAnalysis error:", error.message);
            res.status(500).json({ error: error?.message || "Failed to generate analysis" });
        }
    };

    /**
     * POST /api/guest-analysis/:reservationId/regenerate
     * Regenerate analysis for a reservation
     */
    regenerateAnalysis = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const { inboxId } = req.body;

            logger.info(`[GuestAnalysisController] Regenerating analysis for reservation ${reservationId}`);
            const analysis = await this.analysisService.regenerateAnalysis(reservationId, inboxId);

            res.json({
                success: true,
                data: analysis
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] regenerateAnalysis error:", error.message);
            res.status(500).json({ error: error?.message || "Failed to regenerate analysis" });
        }
    };

    /**
     * GET /api/guest-analysis/:reservationId/history
     * Get all analyses for a reservation, newest first
     */
    getAnalysisHistory = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const analyses = await this.analysisService.getAllAnalysesByReservation(reservationId);

            res.json({
                success: true,
                data: analyses
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getAnalysisHistory error:", error.message);
            res.status(500).json({ error: "Failed to get analysis history" });
        }
    };

    /**
     * GET /api/guest-analysis/:reservationId/communications
     * Get raw communication data for a reservation
     */
    getCommunications = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const communications = await this.communicationService.getAllCommunicationsForReservation(reservationId);

            res.json({
                success: true,
                data: communications,
                count: communications.length
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] getCommunications error:", error.message);
            res.status(500).json({ error: "Failed to get communications" });
        }
    };

    /**
     * POST /api/guest-analysis/:reservationId/fetch-communications
     * Manually trigger fetching communications from sources
     */
    fetchCommunications = async (req: Request, res: Response): Promise<void> => {
        try {
            const reservationId = parseInt(req.params.reservationId, 10);
            if (isNaN(reservationId)) {
                res.status(400).json({ error: "Invalid reservation ID" });
                return;
            }

            const { inboxId } = req.body;
            const results: any = {
                openphone: [],
                hostify: []
            };

            // Fetch from OpenPhone
            const openphoneComms = await this.communicationService.fetchAndStoreFromOpenPhone(reservationId);
            results.openphone = openphoneComms.length;

            // Fetch from Hostify if inboxId provided
            if (inboxId) {
                const hostifyComms = await this.communicationService.fetchAndStoreFromHostify(reservationId, inboxId);
                results.hostify = hostifyComms.length;
            }

            res.json({
                success: true,
                message: "Communications fetched successfully",
                data: results
            });
        } catch (error: any) {
            logger.error("[GuestAnalysisController] fetchCommunications error:", error.message);
            res.status(500).json({ error: "Failed to fetch communications" });
        }
    };

    private buildRecordFilters(req: Request): GuestAnalysisRecordFilters {
        const parseList = (value: unknown): string[] => {
            if (!value) return [];
            if (Array.isArray(value)) {
                return value.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
            }
            return String(value).split(",").map((item) => item.trim()).filter(Boolean);
        };

        return {
            search: typeof req.query.search === "string" ? req.query.search : "",
            bookingPhase: parseList(req.query.bookingPhase) as GuestAnalysisRecordFilters["bookingPhase"],
            sentiment: parseList(req.query.sentiment),
            category: parseList(req.query.category),
            department: parseList(req.query.department),
            status: parseList(req.query.status),
            priority: parseList(req.query.priority),
            property: parseList(req.query.property),
            arrivalDateFrom: typeof req.query.arrivalDateFrom === "string" ? req.query.arrivalDateFrom : undefined,
            arrivalDateTo: typeof req.query.arrivalDateTo === "string" ? req.query.arrivalDateTo : undefined,
            departureDateFrom: typeof req.query.departureDateFrom === "string" ? req.query.departureDateFrom : undefined,
            departureDateTo: typeof req.query.departureDateTo === "string" ? req.query.departureDateTo : undefined,
            sortField: typeof req.query.sortField === "string" ? req.query.sortField : "analyzedAt",
            sortDir: req.query.sortDir === "ASC" ? "ASC" : "DESC",
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 25),
        };
    }
}
