import { Router } from "express";
import { ReportsController } from "../controllers/ReportsController";
import verifySession from "../middleware/verifySession";

const router = Router();
const reportsController = new ReportsController();

router.route('/').get(verifySession, reportsController.getReports);

export default router;