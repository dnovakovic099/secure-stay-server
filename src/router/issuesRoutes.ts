import { Router } from "express";
import { IssuesController } from "../controllers/IssuesController";
import verifySession from "../middleware/verifySession";
import { validateCreateIssue, validateCreateLatestUpdates, validateGetIssues, validateIssueMigrationToActionItem, validateUpdateIssue, validateUpdateLatestUpdates, validateBulkUpdateIssues } from "../middleware/validation/issues/issues.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const issuesController = new IssuesController();

router.route('/')
    .get(
        verifySession,
        validateGetIssues,
        issuesController.getGuestIssues
    )
    .post(
        verifySession,
        fileUpload('issues').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateCreateIssue,
        issuesController.createIssue
    );

router.route('/bulk-update')
    .put(
        verifySession,
        validateBulkUpdateIssues,
        issuesController.bulkUpdateIssues
    );

router.route('/:id')
    .put(
        verifySession,
        fileUpload('issues').fields([
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

router.route('/reservation/:reservationId').get(verifySession, issuesController.getIssuesByReservationId);

router.route('/attachment/:fileName').get(issuesController.getAttachment);

router.route('/unresolved').get(verifySession, issuesController.getUnresolvedIssues);

router.route('/migrate-issues-to-action-items').post(verifySession, validateIssueMigrationToActionItem, issuesController.migrateIssuesToActionItems)

router
    .route('/latestupdates/create')
    .post(
        verifySession,
        validateCreateLatestUpdates,
        issuesController.createIssueUpdates
    );

router
    .route('/latestupdates/udpate')
    .post(
        verifySession,
        validateUpdateLatestUpdates,
        issuesController.updateIssueUpdates
    );

router
    .route('/lastestupdates/delete/:id')
    .delete(
        verifySession,
        issuesController.deleteIssueUpdates
    );


router.route('/migratefilestodrive').get(verifySession, issuesController.migrateFilesToDrive)


export default router;