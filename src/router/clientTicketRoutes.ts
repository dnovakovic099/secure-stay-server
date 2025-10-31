import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ClientTicketController } from "../controllers/ClientTicketController";
import {
  validateCreateClientTicket,
  validateCreateLatestUpdates,
  validateGetClientTicket,
  validateUpdateClientTicket,
  validateUpdateLatestUpdates,
  validateUpdateStatus,
  validateBulkUpdateClientTicket,
  validateUpdateAssignee,
  validateUpdateMistake,
  validateUpdateUrgency,
} from "../middleware/validation/clientTicket/clientTicket.validation";
import { contextMiddleware } from "../middleware/context.middleware";

const router = Router();
const clientTicketController = new ClientTicketController();

router
  .route("/create")
  .post(
    verifySession,
    contextMiddleware,
    validateCreateClientTicket,
    clientTicketController.createClientTicket
  );

router
  .route("/tickets")
  .get(
    verifySession,
    validateGetClientTicket,
    clientTicketController.getClientTickets
  );

router
  .route("/ticket/:id")
  .get(verifySession, clientTicketController.getClientTicketById);

router
  .route("/update")
  .put(
    verifySession,
    contextMiddleware,
    validateUpdateClientTicket,
    clientTicketController.updateClientTicket
  );

router
  .route("/ticket/:id")
  .delete(verifySession, contextMiddleware, clientTicketController.deleteClientTicket);

router
  .route("/update-status")
  .put(
    verifySession,
    contextMiddleware,
    validateUpdateStatus,
    clientTicketController.updateClientTicketStatus
  );

router
  .route("/latestupdates/create")
  .post(
    verifySession,
    validateCreateLatestUpdates,
    clientTicketController.saveClientTicketUpdates
  );

router
  .route("/latestupdates/update")
  .put(
    verifySession,
    validateUpdateLatestUpdates,
    clientTicketController.updateClientTicketUpdates
  );

router
  .route("/latestupdates/delete/:id")
  .delete(verifySession, clientTicketController.deleteClientTicketUpdate);

router
  .route("/bulk-update")
  .put(
    verifySession,
    contextMiddleware,
    validateBulkUpdateClientTicket,
    clientTicketController.bulkUpdateClientTickets
  );

router
  .route("/update-assignee")
  .put(
    verifySession,
    contextMiddleware,
    validateUpdateAssignee,
    clientTicketController.updateAssignee
  );
router
  .route("/update-urgency")
  .put(
    verifySession,
    contextMiddleware,
    validateUpdateUrgency,
    clientTicketController.updateUrgency
  );
router
  .route("/update-mistake")
  .put(
    verifySession,
    contextMiddleware,
    validateUpdateMistake,
    clientTicketController.updateMistake
  );
router
  .route("/export")
  .get(verifySession, clientTicketController.exportTickets);

export default router;
