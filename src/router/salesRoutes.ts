import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";
import {
  validateClientRequest,
  validateParamsWhenFetchingData,
} from "../middleware/validation/sales/client.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const salesController = new SalesController();

router
  .route("/createClient")
  .post(verifySession, validateClientRequest, salesController.createClient);
router.route("/getAllClients").get(
  // verifySession,
  salesController.getAllClients
);
router
  .route("/editClient/:client_id")
  .put(verifySession, validateClientRequest, salesController.updateClient);

router.route("/getDetailsFromAddress").get(
  // verifySession,
  validateParamsWhenFetchingData,
  salesController.getDetailsFromAirDna
);

router.route("/generatePdf/:client_id").get(
  // verifySession,
  fileUpload.fields([{ name: "attachments", maxCount: 10 }]),
  salesController.generatePdf
);
export default router;
