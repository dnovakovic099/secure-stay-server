import { Router } from "express";
import { UnifiedWebhookController } from "../controllers/UnifiedWebhookController";

const router = Router();
const unifiedWebhookController = new UnifiedWebhookController();

router.route('/ha-unified-webhook').post(unifiedWebhookController.handleWebhookResponse);

export default router;