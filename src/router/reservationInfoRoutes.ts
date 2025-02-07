// reservationInfoRoutes
import { Router } from "express";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import verifySession from "../middleware/verifySession";

const router = Router();
router.get("/",verifySession, new ReservationInfoController().getAllReservations);
export default router;

router.get("/export",verifySession, new ReservationInfoController().exportReservationToExcel);
