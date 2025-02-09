import { Router } from "express";
import { IssuesController } from "../controllers/IssuesController";
import verifySession from "../middleware/verifySession";
import { validateCreateIssue, validateUpdateIssue } from "../middleware/validation/issues/issues.validation";
import fileUpload from "../utils/issuesUpload.util";

const router = Router();
const issuesController = new IssuesController();

router.route('/')
    .get(
        verifySession,
        issuesController.getIssues
    )
    .post(
        verifySession,
        fileUpload.fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateCreateIssue,
        issuesController.createIssue
    );

router.route('/:id')
    .put(
        verifySession,
        fileUpload.fields([
            { name: 'attachments', maxCount: 10 }
        ]),
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