// reservationInfoRoutes
import { Router } from "express";
import { ReservationInfoController } from "../controllers/ReservationInfoController";
import verifySession from "../middleware/verifySession";
import { validateGetReservationList, validateGetReservationReport } from "../middleware/validation/accounting/reservation.validation";

const router = Router();


const reservationInfoController = new ReservationInfoController();

router.get("/",verifySession,validateGetReservationList, reservationInfoController.getAllReservations);

router.get("/export",verifySession, reservationInfoController.exportReservationToExcel);

router.put('/updatereservationstatusforstatement', verifySession, reservationInfoController.updateReservationStatusForStatement);

router.post('/sync', verifySession, reservationInfoController.syncReservationById);

router.post('/reservation-generic-report', verifySession, validateGetReservationReport, reservationInfoController.getReservationGenericReport)

router.put('/riskStatus', verifySession, reservationInfoController.updateReservationRiskStatus);

router.get('/by-listing/:listingId', verifySession, reservationInfoController.getReservationsByListingId);

router.get('/past-stays', verifySession, reservationInfoController.getPastReservationsByListingId);

router.get('/tags/shared', verifySession, reservationInfoController.getSharedReservationTags);
router.put('/tags/settings', verifySession, reservationInfoController.updateSharedReservationTagSettings);
router.put('/tags/replace', verifySession, reservationInfoController.replaceSharedReservationTag);
router.put('/:reservationId/tags', verifySession, reservationInfoController.updateReservationTags);

router.get('/:reservationId/history', verifySession, reservationInfoController.getReservationEditHistory);
router.post('/:reservationId/history', verifySession, reservationInfoController.createReservationEditHistory);

// IMPORTANT: This route must come LAST as it matches any path segment as :reservationId
router.get('/:reservationId', verifySession, reservationInfoController.getReservation);

export default router;
