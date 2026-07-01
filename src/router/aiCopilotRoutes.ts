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

export default router;
