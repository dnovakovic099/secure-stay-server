import { Router } from "express";
import { RentalAgreementController } from "../controllers/RentalAgreementController";
import verifySession from "../middleware/verifySession";
import fileUpload from "../utils/upload.util";

const router = Router();
const controller = new RentalAgreementController();

// Public routes — no auth required (guest-facing)
router.get("/guest/:hostifyReservationId", controller.getAgreementForGuest.bind(controller));
router.post(
    "/guest/:hostifyReservationId/upload-id",
    fileUpload("rental-agreement-id").fields([
        { name: "idFront", maxCount: 1 },
        { name: "idBack", maxCount: 1 },
    ]),
    controller.uploadGuestId.bind(controller),
);
router.post("/guest/:hostifyReservationId/sign", controller.submitSigning.bind(controller));
router.get("/guest/:hostifyReservationId/status", controller.getSigningStatus.bind(controller));
router.get("/guest/:hostifyReservationId/download", controller.downloadGuestSigningFile.bind(controller));

// Admin routes — require JWT
router.get("/admin/overview", verifySession, controller.getAdminOverview.bind(controller));
router.get("/admin/preview-context", verifySession, controller.getPreviewContext.bind(controller));
router.post("/admin/manual", verifySession, controller.createManualAgreement.bind(controller));
router.get("/admin/reservation/:hostifyReservationId/document", verifySession, controller.getReservationDocument.bind(controller));
router.put("/admin/reservation/:hostifyReservationId/document", verifySession, controller.updateReservationDocument.bind(controller));
router.post("/admin/reservation/:hostifyReservationId/override", verifySession, controller.updateReservationOverride.bind(controller));
router.get("/signings/reservation/:hostifyReservationId/send-preview", verifySession, controller.getSendPreview.bind(controller));
router.get("/signings/reservation/:hostifyReservationId", verifySession, controller.getSigningsByReservation.bind(controller));
router.get("/signings/:id/download", verifySession, controller.getDownloadUrl.bind(controller));
router.get("/signings/:id/file", verifySession, controller.downloadSigningFile.bind(controller));
router.post("/signings/:id/retry-pdf", verifySession, controller.retryPdfGeneration.bind(controller));
router.post("/signings/reservation/:hostifyReservationId/send", verifySession, controller.sendAgreement.bind(controller));

export default router;
