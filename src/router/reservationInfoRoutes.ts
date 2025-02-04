// reservationInfoRoutes
import { Router } from "express";
import { ReservationInfoController } from "../controllers/ReservationInfoController";

const router = Router();
router.get("/", new ReservationInfoController().getAllReservations);
export default router;