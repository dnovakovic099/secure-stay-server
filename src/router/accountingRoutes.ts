import { ExpenseController } from "../controllers/ExpenseController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateCreateExpense, validateGetExpenseList, validateUpdateExpense, validateUpdateExpenseStatus } from "../middleware/validation/accounting/expense.validation";
import { IncomeController } from "../controllers/IncomeControllers";
import { validateGetIncomeStatement, validateRevenueCalculationRequest } from "../middleware/validation/accounting/income.validation";
import fileUpload from "../utils/upload.util";
import { validateCreateOwnerStatement, validatePrintExpenseIncomeStatement } from "../middleware/validation/accounting/accountingReport.validation";
import { AccountingReportController } from "../controllers/AccountingReportController";
import verifyMobileSession from "../middleware/verifyMobileSession";
import { ContractorInfoController } from "../controllers/ContractorController";
import { validateContractorInfo } from "../middleware/validation/accounting/contractor.validation";
import { ResolutionController } from "../controllers/ResolutionController";
import { validateCreateResolution } from '../middleware/validation/accounting/resolution.validation';

const router = Router();
const expenseController = new ExpenseController();
const incomeController = new IncomeController();
const accountingController = new AccountingReportController();
const contractorInfoController = new ContractorInfoController();
const resolutionController = new ResolutionController();

router.route('/createexpense')
    .post(
        verifySession,
        fileUpload('expense').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateCreateExpense,
        expenseController.createExpense
    );

router.route('/updateexpense')
    .put(
        verifySession,
        fileUpload('expense').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateUpdateExpense,
        expenseController.updateExpense
    );

router.route('/getexpenses').get(verifySession, validateGetExpenseList, expenseController.getExpenseList);

router.route("/gettotalexpense").get(verifyMobileSession, expenseController.getTotalExpenseByUserId);

router.route('/getexpense/:expenseId').get(verifySession, expenseController.getExpenseById);

router.route('/deleteexpense/:expenseId').delete(verifySession, expenseController.deleteExpense);

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

router.route('/requestrevenuecalculation')
    .post(
        verifyMobileSession,
        validateRevenueCalculationRequest,
        incomeController.requestRevenueCalculation
    )

router.route('/createownerstatement')
    .post(
        verifySession,
        validateCreateOwnerStatement,
        accountingController.createOwnerStatement
    )

router.route('/getownerstatements')
    .get(
        verifySession,
        accountingController.getOwnerStatements
    )

router.route('/savecontractorinfo')
    .post(
        verifySession,
        validateContractorInfo,
        contractorInfoController.saveContractorInfo
    );

router.route('/getcontractors')
    .get(
        verifySession,
        contractorInfoController.getContractors
    )    

router.route('/createresolution')
    .post(
        verifySession,
        validateCreateResolution,
        resolutionController.createResolution
    );

router.route('/getresolutions')
    .get(
        verifySession,
        resolutionController.getResolutions
    );

router.route('/getresolution/:resolutionId')
    .get(
        verifySession,
        resolutionController.getResolutionById
    );

router.route('/deleteresolution/:resolutionId')
    .delete(
        verifySession,
        resolutionController.deleteResolution
    );

export default router;
