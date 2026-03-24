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
