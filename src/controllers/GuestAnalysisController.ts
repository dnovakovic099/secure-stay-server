import { Request, Response } from "express";
import { GuestAnalysisService } from "../services/GuestAnalysisService";
import { GuestCommunicationService } from "../services/GuestCommunicationService";
import logger from "../utils/logger.utils";

/**
 * GuestAnalysisController
 * Handles API endpoints for guest communication analysis
 */
export class GuestAnalysisController {
    private analysisService: GuestAnalysisService;
    private communicationService: GuestCommunicationService;

    constructor() {
        this.analysisService = new GuestAnalysisService();
        this.communicationService = new GuestCommunicationService();
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
            res.status(500).json({ error: "Failed to generate analysis" });
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
            res.status(500).json({ error: "Failed to regenerate analysis" });
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
}
