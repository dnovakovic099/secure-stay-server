import { Router } from "express";
import { ReservationController } from "../controllers/ReservationController";
import verifySession from "../middleware/verifySession";
const router = Router();
const reservationController = new ReservationController();

router.route('/channellist').get(verifySession, reservationController.getChannelList);

export default router;