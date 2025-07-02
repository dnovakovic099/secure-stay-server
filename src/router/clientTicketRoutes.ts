import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ClientTicketController } from "../controllers/ClientTicketController";
import { validateCreateClientTicket, validateGetClientTicket, validateUpdateClientTicket, validateUpdateStatus } from "../middleware/validation/clientTicket/clientTicket.validation";

const router = Router();
const clientTicketController = new ClientTicketController;

router
    .route('/create')
    .post(verifySession, validateCreateClientTicket, clientTicketController.createClientTicket);

router
    .route('/tickets')
    .get(verifySession, validateGetClientTicket, clientTicketController.getClientTickets);

router
    .route('/ticket/:id')
    .get(verifySession, clientTicketController.getClientTicketById);

router
    .route('/update')
    .put(verifySession, validateUpdateClientTicket, clientTicketController.updateClientTicket);

router
    .route('/ticket/:id')
    .delete(verifySession, clientTicketController.deleteClientTicket);

router
    .route('/update-status')
    .put(verifySession, validateUpdateStatus, clientTicketController.updateClientTicketStatus);

export default router;
