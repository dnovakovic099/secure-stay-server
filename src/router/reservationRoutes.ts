import { Router } from "express";
import { ReservationController } from "../controllers/ReservationController";
import verifySession from "../middleware/verifySession";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
const router = Router();
const reservationController = new ReservationController();
const reservationInfoController = new ReservationInfoController();

router.route('/channellist').get(verifySession, reservationController.getChannelList);

router.route('/syncreservation').post(verifySession, reservationInfoController.syncReservations)

export default router;