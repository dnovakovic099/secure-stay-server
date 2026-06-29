import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { LLBuddyController } from "../controllers/LLBuddyController";

const router = Router();
const controller = new LLBuddyController();

router.use(verifySession);

router.get("/overview", controller.overview);
router.get("/conversations", controller.conversations);
router.get("/conversations/:id", controller.conversationDetail);
router.get("/suggestions", controller.suggestions);
router.get("/action-items", controller.actionItems);
router.get("/guest-issues", controller.guestIssues);
router.get("/feedback", controller.feedback);
router.get("/learning-review", controller.learning);
router.get("/audit-logs", controller.auditLogs);

router.post("/analyze/recent", controller.analyzeRecent);
router.post("/sync/recent", controller.syncRecent);
router.post("/learning-review/process", controller.processLearning);
router.post("/conversations/:id/reply", controller.sendReply);
router.post("/suggestions/:suggestionId/feedback", controller.recordFeedback);
router.put("/learning-review/:id", controller.reviewLearning);

export default router;
