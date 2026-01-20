import { Router } from "express";
import { UnifiedWebhookController } from "../controllers/UnifiedWebhookController";
import { ZapierWebhookController } from "../controllers/ZapierWebhookController";
import bodyParser from "body-parser"

const router = Router();
const unifiedWebhookController = new UnifiedWebhookController();
const zapierWebhookController = new ZapierWebhookController();

router.route('/ha-unified-webhook').post(unifiedWebhookController.handleWebhookResponse);

router.route('/slack-interactivity-webhook').post(bodyParser.urlencoded({ extended: true }), unifiedWebhookController.handleSlackInteractivity);

router.route('/hostbuddy-webhook').post(unifiedWebhookController.handleHostBuddyWebhook);

router.route('/hostify_v1').post(bodyParser.text({ type: "*/*" }), unifiedWebhookController.handleHostifyWebhook);

// Slack Events API endpoint for receiving thread replies
router.route('/slack-events-webhook').post(unifiedWebhookController.handleSlackEventsWebhook);

// Zapier webhook endpoint
router.route('/zapier').post(zapierWebhookController.handleWebhook);

export default router;