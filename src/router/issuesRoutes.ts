import { Router } from "express";
import { IssuesController } from "../controllers/IssuesController";
import verifySession from "../middleware/verifySession";
import { validateCreateIssue, validateUpdateIssue } from "../middleware/validation/issues/issues.validation";

const router = Router();
const issuesController = new IssuesController();

router.route('/')
    .get(
        verifySession,
        issuesController.getIssues
    )
    .post(
        verifySession,
        validateCreateIssue,
        issuesController.createIssue
    );

router.route('/:id')
    .put(
        verifySession,
        validateUpdateIssue,
        issuesController.updateIssue
    )
    .delete(
        verifySession,
        issuesController.deleteIssue
    );

router.route('/export')
    .get(
        verifySession,
        issuesController.exportIssuesToExcel
    );

export default router;