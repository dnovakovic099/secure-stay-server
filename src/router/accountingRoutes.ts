import { ExpenseController } from "../controllers/ExpenseController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateCreateExpense } from "../middleware/validation/accounting/expense.validation";

const router = Router();
const expenseController = new ExpenseController();

router.route('/createexpense').post(verifySession, validateCreateExpense, expenseController.createExpense);

export default router;
