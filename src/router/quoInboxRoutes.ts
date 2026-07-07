import { Router } from "express";
import { QuoInboxController } from "../controllers/QuoInboxController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new QuoInboxController();

router.get("/lines", verifySession, controller.listLines);
router.patch("/lines/:id", verifySession, controller.updateLine);
router.get("/conversations", verifySession, controller.listConversations);
router.get("/conversations/:conversationId", verifySession, controller.getConversation);
router.post("/conversations/:conversationId/reply", verifySession, controller.reply);
router.post("/conversations/:conversationId/read", verifySession, controller.markRead);
router.post("/conversations/:conversationId/link", verifySession, controller.link);
router.post("/sync", verifySession, controller.sync);

export default router;
