import { ExpenseController } from "../controllers/ExpenseController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateCreateExpense, validateGetExpenseList, validateUpdateExpense } from "../middleware/validation/accounting/expense.validation";
import { IncomeController } from "../controllers/IncomeControllers";
import { validateGetIncomeStatement } from "../middleware/validation/accounting/income.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const expenseController = new ExpenseController();
const incomeController = new IncomeController();

router.route('/createexpense')
    .post(
        verifySession,
        fileUpload.fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateCreateExpense,
        expenseController.createExpense
    );

router.route('/updateexpense')
    .put(
        verifySession,
        fileUpload.fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateUpdateExpense,
        expenseController.updateExpense
    );

router.route('/getexpenses').get(verifySession, validateGetExpenseList, expenseController.getExpenseList);

router.route('/getincomestatement').post(verifySession, validateGetIncomeStatement, incomeController.generateIncomeStatement);

export default router;
