import { Router } from "express";
import { ReservationDetailPreStayAuditController } from "../controllers/ReservationDetailPreStayAuditController";
import verifySession from "../middleware/verifySession";

const router = Router();
const preStayAuditController = new ReservationDetailPreStayAuditController();

router.post("/:reservationId",verifySession, preStayAuditController.createAudit.bind(preStayAuditController));
router.put("/:reservationId",verifySession, preStayAuditController.updateAudit.bind(preStayAuditController));
router.get("/:reservationId",verifySession, preStayAuditController.getAuditByReservationId.bind(preStayAuditController));

export default router; 