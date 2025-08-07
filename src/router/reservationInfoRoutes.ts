// reservationInfoRoutes
import { Router } from "express";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import verifySession from "../middleware/verifySession";
import { validateGetReservationList } from "../middleware/validation/accounting/reservation.validation";

const router = Router();


const reservationInfoController = new ReservationInfoController();

router.get("/",verifySession,validateGetReservationList, reservationInfoController.getAllReservations);

router.get("/export",verifySession, reservationInfoController.exportReservationToExcel);

router.put('/updatereservationstatusforstatement', verifySession, reservationInfoController.updateReservationStatusForStatement);

router.get('/:reservationId', verifySession, reservationInfoController.getReservation);

router.post('/sync', verifySession, reservationInfoController.syncReservationById);

export default router;