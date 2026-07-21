import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { UserNotificationController } from "../controllers/UserNotificationController";

const router = Router();
const controller = new UserNotificationController();

router.get("/settings", verifySession, controller.getSettings);
router.put("/settings", verifySession, controller.updateSettings);
router.post("/seen", verifySession, controller.markSeen);
router.get("/events", verifySession, controller.listEvents);

export default router;
