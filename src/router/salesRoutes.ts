import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";
import { validateClientRequest } from "../middleware/validation/sales/client.validation";

const router = Router();
const salesController = new SalesController();

router
  .route("/createClient")
  .post(verifySession, validateClientRequest, salesController.createClient);
router
  .route("/getAllClients")
  .get(verifySession, salesController.getAllClients);
router
  .route("/editClient/:client_id")
  .put(verifySession, validateClientRequest, salesController.updateClient);

export default router;
