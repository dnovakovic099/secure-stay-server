import { Router } from "express";
import { UnifiedWebhookController } from "../controllers/UnifiedWebhookController";
import bodyParser from "body-parser"

const router = Router();
const unifiedWebhookController = new UnifiedWebhookController();

router.route('/ha-unified-webhook').post(unifiedWebhookController.handleWebhookResponse);

router.route('/slack-interactivity-webhook').post(bodyParser.urlencoded({ extended: true }), unifiedWebhookController.handleSlackInteractivity);

router.route('/hostbuddy-webhook').post(unifiedWebhookController.handleHostBuddyWebhook);

router.route('/hostify_v1').post(bodyParser.text({ type: "*/*" }), unifiedWebhookController.handleHostifyWebhook);

// Slack Events API endpoint for receiving thread replies
router.route('/slack-events-webhook').post(unifiedWebhookController.handleSlackEventsWebhook);

export default router;