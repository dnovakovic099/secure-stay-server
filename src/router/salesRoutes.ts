import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { SalesController } from "../controllers/SalesController";
import { DailySalesReportController } from "../controllers/DailySalesReportController";
import {
  validateClientRequest,
  validateParamsWhenFetchingData,
} from "../middleware/validation/sales/client.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const salesController = new SalesController();
const dailySalesReportController = new DailySalesReportController();

router.route("/createClient").post(
  // verifySession,
  // fileUpload.fields([{ name: "attachments", maxCount: 10 }]),
  validateClientRequest,
  salesController.createClient
);
router.route("/getAllClients").get(
  // verifySession,
  salesController.getAllClients
);
router
  .route("/editClient/:client_id")
  .put(validateClientRequest, salesController.updateClient);

router.route("/getDetailsFromAddress").get(
  // verifySession,
  validateParamsWhenFetchingData,
  salesController.getDetailsFromAirDna
);
router.route("/getPropertyDetailsFromLink").get(
  // verifySession,
  salesController.getDetailsForListing
);

router.route("/getCompetitorPropertyDetailsFromLink").get(
  // verifySession,
  salesController.getDetailsForCompetitorListing
);


router.route("/generatePdf/:client_id").get(
  // verifySession,
  // fileUpload.fields([{ name: "attachments", maxCount: 10 }]),
  salesController.generatePdf
);


router.route("/upload-revenue-report").post(
  // verifySession,
  fileUpload('revenue-report').fields([{ name: 'file', maxCount: 1 }]),
  salesController.uploadRevenueReport
);

// Daily growth-leads report (Atlas) — auth required: run spends paid API credits.
router.route("/dailyLeadsReport/run").post(
  verifySession,
  dailySalesReportController.runReport
);
router.route("/dailyLeadsReport/leads").get(
  verifySession,
  dailySalesReportController.getLeads
);
router.route("/dailyLeadsReport/leads/:lead_id/status").put(
  verifySession,
  dailySalesReportController.updateLeadStatus
);


export default router;
