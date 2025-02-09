import { Router } from "express";
import { ReservationDetailPostStayAuditController } from "../controllers/ReservationDetailPostStayAuditController";
import verifySession from "../middleware/verifySession";
import fileUpload from "../utils/upload.util";

const router = Router();
const postStayAuditController = new ReservationDetailPostStayAuditController();

router.post("/:reservationId", verifySession, fileUpload('post-stay-audit').fields([
    { name: 'attachments', maxCount: 10 }
]), postStayAuditController.createAudit.bind(postStayAuditController));
router.put("/:reservationId", verifySession, fileUpload('post-stay-audit').fields([
    { name: 'attachments', maxCount: 10 }
]), postStayAuditController.updateAudit.bind(postStayAuditController));
router.get("/:reservationId", verifySession, postStayAuditController.getAuditByReservationId.bind(postStayAuditController));

export default router; 