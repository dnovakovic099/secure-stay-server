import { Router } from "express";
import { ReservationDetailPostStayAuditController } from "../controllers/ReservationDetailPostStayAuditController";
import verifySession from "../middleware/verifySession";

const router = Router();
const postStayAuditController = new ReservationDetailPostStayAuditController();

router.post("/:reservationId",verifySession, postStayAuditController.createAudit.bind(postStayAuditController));
router.put("/:reservationId",verifySession, postStayAuditController.updateAudit.bind(postStayAuditController));
router.get("/:reservationId",verifySession, postStayAuditController.getAuditByReservationId.bind(postStayAuditController));

export default router; 