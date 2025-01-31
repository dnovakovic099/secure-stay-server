import { Router } from "express";
import { ReservationDetailPostStayAuditController } from "../controllers/ReservationDetailPostStayAuditController";

const router = Router();
const postStayAuditController = new ReservationDetailPostStayAuditController();

router.post("/:reservationId", postStayAuditController.createAudit.bind(postStayAuditController));
router.put("/:reservationId", postStayAuditController.updateAudit.bind(postStayAuditController));
router.get("/:reservationId", postStayAuditController.getAuditByReservationId.bind(postStayAuditController));

export default router; 