import { Router } from "express";
import { ReportsController } from "../controllers/ReportsController";
import verifySession from "../middleware/verifySession";
import { validateGetIncomeStatement } from "../middleware/validation/accounting/income.validation";

const router = Router();
const reportsController = new ReportsController();

router.route('/').post(verifySession, validateGetIncomeStatement, reportsController.getReports);

export default router;