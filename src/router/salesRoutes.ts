import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";
import { validateCreateClientRequest } from "../middleware/validation/sales/client.validation";

const router = Router();
const salesController = new SalesController();

router
  .route("/createClient")
  .post(
    verifySession,
    validateCreateClientRequest,
    salesController.createClient
  );
router
  .route("/getAllClients")
  .get(verifySession, salesController.getAllClients);

export default router;
