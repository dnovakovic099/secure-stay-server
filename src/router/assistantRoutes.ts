import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { AssistantController } from "../controllers/AssistantController";

const router = Router();
const controller = new AssistantController();

// Every route is session-gated; the per-capability checks that decide what the
// assistant may actually read live in services/assistant/viewer.ts and are
// enforced inside each tool.
router.post("/ask", verifySession, controller.ask);
router.get("/conversations", verifySession, controller.listConversations);
router.get("/conversations/:id/messages", verifySession, controller.getMessages);
router.post("/conversations/:id/archive", verifySession, controller.archiveConversation);
router.get("/preferences", verifySession, controller.getPreferences);
router.put("/preferences", verifySession, controller.updatePreferences);

export default router;
