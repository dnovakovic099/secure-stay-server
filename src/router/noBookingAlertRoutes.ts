import { Router } from "express";
import { NoBookingAlertController } from "../controllers/NoBookingAlertController";
import verifySession from "../middleware/verifySession";

const router = Router();
const noBookingAlertController = new NoBookingAlertController();

/**
 * POST /no-booking-alert
 * Trigger a no booking alert check for a custom date
 * Request body: { date: "yyyy-MM-dd" }
 */
router.route('/').post(verifySession, noBookingAlertController.triggerNoBookingAlert);

export default router;
