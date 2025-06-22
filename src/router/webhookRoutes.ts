import { Router } from "express";
import { UnifiedWebhookController } from "../controllers/UnifiedWebhookController";
import bodyParser from "body-parser"

const router = Router();
const unifiedWebhookController = new UnifiedWebhookController();

router.route('/ha-unified-webhook').post(unifiedWebhookController.handleWebhookResponse);

router.route('/slack-interactivity-webhook').post(bodyParser.urlencoded({ extended: true }), unifiedWebhookController.handleSlackInteractivity);

router.route('/hostbuddy-webhook').post(unifiedWebhookController.handleHostBuddyWebhook);

export default router;