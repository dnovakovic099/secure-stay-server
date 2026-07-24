import { Router } from "express";
import { ReservationController } from "../controllers/ReservationController";
import verifySession from "../middleware/verifySession";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
const router = Router();
const reservationController = new ReservationController();
const reservationInfoController = new ReservationInfoController();

router.route('/channellist').get(verifySession, reservationController.getChannelList);

router.route('/syncreservation').post(verifySession, reservationInfoController.syncReservations)

// Re-fetch a single reservation from Hostify's detail endpoint (which includes
// the fees breakdown) and persist the refreshed row. Used by the Claims Fee
// Funds report to backfill fees for reservations that were originally synced
// before the fee columns were being extracted.
router.route('/resync-reservation-by-id').post(verifySession, reservationInfoController.syncReservationById)

export default router;