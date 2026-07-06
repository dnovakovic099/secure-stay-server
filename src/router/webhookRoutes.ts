import { Router } from "express";
import { UnifiedWebhookController } from "../controllers/UnifiedWebhookController";
import { ZapierWebhookController } from "../controllers/ZapierWebhookController";
import { ThreadController } from "../controllers/ThreadController";
import { EscalationSettingsController } from "../controllers/EscalationSettingsController";
import bodyParser from "body-parser"
import verifyMobileSession from "../middleware/verifyMobileSession";
import verifySession from "../middleware/verifySession";

const router = Router();
const unifiedWebhookController = new UnifiedWebhookController();
const zapierWebhookController = new ZapierWebhookController();
const threadController = new ThreadController();
const escalationSettingsController = new EscalationSettingsController();

router.route('/ha-unified-webhook').post(unifiedWebhookController.handleWebhookResponse);
router.route('/stripe').post(unifiedWebhookController.handleStripeWebhook);

router.route('/slack-interactivity-webhook').post(bodyParser.urlencoded({ extended: true }), unifiedWebhookController.handleSlackInteractivity);

router.route('/hostbuddy-webhook').post(unifiedWebhookController.handleHostBuddyWebhook);

router.route('/hostify_v1').post(bodyParser.text({ type: "*/*" }), unifiedWebhookController.handleHostifyWebhook);

// Slack Events API endpoint for receiving thread replies
router.route('/slack-events-webhook').post(unifiedWebhookController.handleSlackEventsWebhook);

// Zapier webhook endpoint
router.route('/zapier').post(zapierWebhookController.handleWebhook);

// Zapier events management endpoints (for GR Tasks page)
router.route('/zapier/events').get(verifySession, zapierWebhookController.getEvents);
router.route('/zapier/events/activity').get(verifySession, zapierWebhookController.getActivityData);
router.route('/zapier/events/bulk-update-status').put(verifySession, zapierWebhookController.bulkUpdateEventStatus);
router.route('/zapier/events/:id').get(verifySession, zapierWebhookController.getEventById);
router.route('/zapier/events/:id/status').put(verifySession, zapierWebhookController.updateEventStatus);
router.route('/zapier/event-types').get(verifySession, zapierWebhookController.getEventTypes);
router.route('/zapier/slack-channels').get(verifySession, zapierWebhookController.getSlackChannels);


// Thread messages for GR Tasks (Slack sync)
router.route('/zapier/events/:id/thread').get(verifySession, threadController.getThreadMessages);
router.route('/zapier/events/:id/thread').post(verifySession, threadController.postThreadMessage);

// Escalation settings for GR Tasks reminders
router.route('/zapier/escalation-settings').get(verifySession, escalationSettingsController.getAllSettings);
router.route('/zapier/escalation-settings').post(verifySession, escalationSettingsController.createSettings);
router.route('/zapier/escalation-settings/employees/gr').get(verifySession, escalationSettingsController.getGREmployees);
router.route('/zapier/escalation-settings/:key').get(verifySession, escalationSettingsController.getSettingsByKey);
router.route('/zapier/escalation-settings/:key').put(verifySession, escalationSettingsController.updateSettings);
router.route('/zapier/escalation-settings/:key').delete(verifySession, escalationSettingsController.deleteSettings);


export default router;
