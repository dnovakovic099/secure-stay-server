import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";
import { validateClientRequest } from "../middleware/validation/sales/client.validation";

const router = Router();
const salesController = new SalesController();

router
  .route("/createClient")
  .post(validateClientRequest, salesController.createClient);
router.route("/getAllClients").get(salesController.getAllClients);
router
  .route("/editClient/:client_id")
  .put(verifySession, validateClientRequest, salesController.updateClient);

router
  .route("/generatePerformanceReport/:client_id")
  .get(salesController.generatePdfForClient);

export default router;
