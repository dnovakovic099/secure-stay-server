import { Router } from "express";
import { ReservationDetailPreStayAuditController } from "../controllers/ReservationDetailPreStayAuditController";
import verifySession from "../middleware/verifySession";
import fileUpload from "../utils/upload.util";

const router = Router();
const preStayAuditController = new ReservationDetailPreStayAuditController();

router.get("/migratefilestodrive", verifySession, preStayAuditController.migrateFileToDrive.bind(preStayAuditController));

router.post("/:reservationId",verifySession, fileUpload('pre-stay-audit').fields([
    { name: 'attachments', maxCount: 10 }
]), preStayAuditController.createAudit.bind(preStayAuditController));
router.put("/:reservationId",verifySession, fileUpload('pre-stay-audit').fields([
    { name: 'attachments', maxCount: 10 }
]), preStayAuditController.updateAudit.bind(preStayAuditController));
router.get("/:reservationId", verifySession, preStayAuditController.getAuditByReservationId.bind(preStayAuditController));

export default router; 