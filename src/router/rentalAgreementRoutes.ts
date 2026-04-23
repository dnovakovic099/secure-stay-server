import { Router } from "express";
import { RentalAgreementController } from "../controllers/RentalAgreementController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new RentalAgreementController();

// Public routes — no auth required (guest-facing)
router.get("/guest/:hostifyReservationId", controller.getAgreementForGuest.bind(controller));
router.post("/guest/:hostifyReservationId/sign", controller.submitSigning.bind(controller));
router.get("/guest/:hostifyReservationId/status", controller.getSigningStatus.bind(controller));

// Admin routes — require JWT
router.get("/signings/reservation/:hostifyReservationId", verifySession, controller.getSigningsByReservation.bind(controller));
router.get("/signings/:id/download", verifySession, controller.getDownloadUrl.bind(controller));

export default router;
