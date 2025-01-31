import { Router } from "express";
import { ReservationDetailPreStayAuditController } from "../controllers/ReservationDetailPreStayAuditController";

const router = Router();
const preStayAuditController = new ReservationDetailPreStayAuditController();

router.post("/:reservationId", preStayAuditController.createAudit.bind(preStayAuditController));
router.put("/:reservationId", preStayAuditController.updateAudit.bind(preStayAuditController));
router.get("/:reservationId", preStayAuditController.getAuditByReservationId.bind(preStayAuditController));

export default router; 