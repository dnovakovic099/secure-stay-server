import { ExpenseController } from "../controllers/ExpenseController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateCreateExpense, validateGetExpenseList, validateUpdateExpense, validateUpdateExpenseStatus } from "../middleware/validation/accounting/expense.validation";
import { IncomeController } from "../controllers/IncomeControllers";
import { validateGetIncomeStatement } from "../middleware/validation/accounting/income.validation";
import fileUpload from "../utils/upload.util";
import { validatePrintExpenseIncomeStatement } from "../middleware/validation/accounting/accountingReport.validation";
import { AccountingReportController } from "../controllers/AccountingReportController";
import verifyMobileSession from "../middleware/verifyMobileSession";

const router = Router();
const expenseController = new ExpenseController();
const incomeController = new IncomeController();
const accountingController = new AccountingReportController();

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

router.route("/gettotalexpense").get(verifyMobileSession, expenseController.getTotalExpenseByUserId);

router.route('/getexpense/:expenseId').get(verifySession, expenseController.getExpenseById);

router.route('/getincomestatement').post(verifySession, validateGetIncomeStatement, incomeController.generateIncomeStatement);

router.route("/updateexpensestatus")
    .put(
        verifySession,
        validateUpdateExpenseStatus,
        expenseController.updateExpenseStatus
);

router.route('/printexpenseincomestatement')
    .get(
        verifySession,
        validatePrintExpenseIncomeStatement,
        accountingController.printExpenseIncomeStatement
    )

export default router;
