import { Router } from "express";
import { TurnoverController } from "../controllers/TurnoverController";
import verifySession from "../middleware/verifySession";

const router = Router();
const turnoverController = new TurnoverController();

// Notifications
router.route('/notifications').get(verifySession, turnoverController.getNotifications.bind(turnoverController));
router.route('/notifications/:reservationId/:type/status').post(verifySession, turnoverController.updateNotificationStatus.bind(turnoverController));
router.route('/notifications/:reservationId/:type/recipient').put(verifySession, turnoverController.updateNotificationRecipient.bind(turnoverController));
router.route('/notifications/:reservationId/:type/retry').post(verifySession, turnoverController.retryNotification.bind(turnoverController));

// Settings
router.route('/settings').get(verifySession, turnoverController.getSettings.bind(turnoverController));
router.route('/settings/bulk').post(verifySession, turnoverController.bulkUpdateSettings.bind(turnoverController));
router.route('/settings/:listingId').put(verifySession, turnoverController.updateSettings.bind(turnoverController));

// Contacts
router.route('/contacts/:listingId').get(verifySession, turnoverController.getContactsForListing.bind(turnoverController));

// Owner sync
router.route('/sync-owners').post(verifySession, turnoverController.syncOwners.bind(turnoverController));

export default router;
