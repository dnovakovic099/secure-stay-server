import { Router } from "express";
import { GuestAnalysisController } from "../controllers/GuestAnalysisController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new GuestAnalysisController();

// All routes require authentication
router.use(verifySession);

// GET /api/guest-analysis/bulk - Get existing analyses for multiple reservations
router.get("/bulk", controller.getBulkAnalyses);

// GET /api/guest-analysis/summary - Get summary grouped by booking phase
router.get("/summary", controller.getSummary);

// GET /api/guest-analysis/records - Get AI analysis records table data
router.get("/records", controller.getRecords);

// GET /api/guest-analysis/records/:reservationId - Get reservation drill-in detail
router.get("/records/:reservationId", controller.getRecordDetail);

// GET /api/guest-analysis/settings - Get taxonomy/settings
router.get("/settings", controller.getSettings);

// PUT /api/guest-analysis/settings - Update taxonomy/settings
router.put("/settings", controller.updateSettings);

// GET /api/guest-analysis/report-threads - List saved report threads
router.get("/report-threads", controller.listReportThreads);

// POST /api/guest-analysis/report-threads - Create a saved report thread
router.post("/report-threads", controller.createReportThread);

// GET /api/guest-analysis/report-threads/:threadId - Load a saved report thread
router.get("/report-threads/:threadId", controller.getReportThread);

// POST /api/guest-analysis/report-threads/:threadId/messages - Add a user message and generate a report response
router.post("/report-threads/:threadId/messages", controller.createReportThreadMessage);

// GET /api/guest-analysis/:reservationId - Get existing analysis
router.get("/:reservationId", controller.getAnalysis);

// POST /api/guest-analysis/:reservationId/generate - Generate new analysis
router.post("/:reservationId/generate", controller.generateAnalysis);

// POST /api/guest-analysis/:reservationId/regenerate - Regenerate analysis
router.post("/:reservationId/regenerate", controller.regenerateAnalysis);

// GET /api/guest-analysis/:reservationId/history - Get all analyses (newest first)
router.get("/:reservationId/history", controller.getAnalysisHistory);

// GET /api/guest-analysis/:reservationId/communications - Get raw communications
router.get("/:reservationId/communications", controller.getCommunications);

// POST /api/guest-analysis/:reservationId/fetch-communications - Fetch from sources
router.post("/:reservationId/fetch-communications", controller.fetchCommunications);

export default router;
