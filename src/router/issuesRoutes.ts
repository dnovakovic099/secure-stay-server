import { Router } from "express";
import { IssuesController } from "../controllers/IssuesController";
import verifySession from "../middleware/verifySession";

const router = Router();
const issuesController = new IssuesController();

router.route('/')
    .get(
        verifySession,
        issuesController.getIssues
    )
    .post(
        verifySession,
        issuesController.createIssue
    );

router.route('/:id')
    .put(
        verifySession,
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