// reservationInfoRoutes
import { Router } from "express";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import verifySession from "../middleware/verifySession";

const router = Router();


const reservationInfoController = new ReservationInfoController();

router.get("/",verifySession, reservationInfoController.getAllReservations);
export default router;

router.get("/export",verifySession, reservationInfoController.exportReservationToExcel);