import { Router } from "express";
import { RentalAgreementController } from "../controllers/RentalAgreementController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new RentalAgreementController();

// Public routes — no auth required (guest-facing)
router.get("/guest/:hostifyReservationId", controller.getAgreementForGuest.bind(controller));
router.post("/guest/:hostifyReservationId/sign", controller.submitSigning.bind(controller));
router.get("/guest/:hostifyReservationId/status", controller.getSigningStatus.bind(controller));
router.get("/guest/:hostifyReservationId/download", controller.downloadGuestSigningFile.bind(controller));

// Admin routes — require JWT
router.get("/admin/overview", verifySession, controller.getAdminOverview.bind(controller));
router.get("/signings/reservation/:hostifyReservationId", verifySession, controller.getSigningsByReservation.bind(controller));
router.get("/signings/:id/download", verifySession, controller.getDownloadUrl.bind(controller));
router.get("/signings/:id/file", verifySession, controller.downloadSigningFile.bind(controller));
router.post("/signings/:id/retry-pdf", verifySession, controller.retryPdfGeneration.bind(controller));
router.post("/signings/reservation/:hostifyReservationId/send", verifySession, controller.sendAgreement.bind(controller));

export default router;
