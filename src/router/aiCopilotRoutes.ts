import { Router } from "express";
import { AICopilotController } from "../controllers/AICopilotController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new AICopilotController();

// AI Copilot Settings (tone / rules / topics-to-avoid / auto-respond toggle).
// Mounted under /ai alongside the AI Escalation Manager routes; paths do not
// collide (/ai/settings, /ai/suggestions, /ai/metrics vs /ai/logs, /ai/assistant).
router.get("/settings", verifySession, controller.getSettings);
router.put("/settings", verifySession, controller.updateSettings);

// AI Copilot review: recent suggestions across all threads.
router.get("/suggestions", verifySession, controller.listSuggestions);

// AI Manager: aggregate response/suggestion metrics.
router.get("/metrics", verifySession, controller.metrics);

// Detected Action Item / Guest Issue proposals (dormant pipeline review).
router.get("/detected-items", verifySession, controller.detectedItems);

// Learned facts (nightly audit output) — review + approve/reject for the bot.
router.get("/learned-facts", verifySession, controller.listLearnedFacts);
router.post("/learned-facts/approve-all", verifySession, controller.approveAllLearnedFacts);
router.post("/learned-facts/:id/review", verifySession, controller.reviewLearnedFact);

// On-demand trigger of the nightly self-improvement audit.
router.post("/audit/run", verifySession, controller.runAudit);

// Seed KB from structured listing data + one-shot full-history learning.
router.post("/kb/seed-from-listings", verifySession, controller.seedKnowledgeFromListings);
router.post("/audit/backfill-history", verifySession, controller.backfillHistory);

export default router;
