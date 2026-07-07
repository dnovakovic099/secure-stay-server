import { Router } from "express";
import { OverduePaymentController } from "../controllers/OverduePaymentController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new OverduePaymentController();

router.get("/", verifySession, controller.list);
router.post("/sync", verifySession, controller.sync);
router.post("/conversations/:threadId/resolve", verifySession, controller.resolveEmergency);

export default router;
