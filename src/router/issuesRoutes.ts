import { Router } from "express";
import { IssuesController } from "../controllers/IssuesController";
import verifySession from "../middleware/verifySession";
import { validateCreateIssue, validateCreateLatestUpdates, validateGetIssues, validateIssueMigrationToActionItem, validateUpdateIssue, validateUpdateLatestUpdates, validateBulkUpdateIssues, validateUpdateAssignee, validateUpdateMistake, validateUpdateUrgency, validateUpdateStatus, validateIssueQuickAction } from "../middleware/validation/issues/issues.validation";
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

router.route('/update-assignee').put(verifySession, validateUpdateAssignee, issuesController.updateAssignee);
router.route('/update-urgency').put(verifySession, validateUpdateUrgency, issuesController.updateUrgency);
router.route('/update-mistake').put(verifySession, validateUpdateMistake, issuesController.updateMistake);
router.route('/update-status').put(verifySession, validateUpdateStatus, issuesController.updateStatus)
router.route('/quick-action').post(verifySession, validateIssueQuickAction, issuesController.quickAction);
router.route('/slack-thread-preview').get(verifySession, issuesController.previewSlackThread);
router.route('/slack-file').get(verifySession, issuesController.proxySlackFile);
router.route('/:id/ai-summary').post(verifySession, issuesController.generateAiSummary);
router.route('/:id/resolution-analysis').post(verifySession, issuesController.generateResolutionAnalysis);
router.route('/:id/resolution-analysis/refresh-if-stale').post(verifySession, issuesController.refreshResolutionAnalysisIfStale);
// IR Copilot (playbook + contacts + feedback + Phase 2 execute)
router.route('/:id/ir-suggest').get(verifySession, issuesController.getIrSuggestion);
router.route('/:id/ir-suggest').post(verifySession, issuesController.suggestIrCopilot);
router.route('/:id/ir-feedback').post(verifySession, issuesController.irCopilotFeedback);
router.route('/:id/ir-send-guest').post(verifySession, issuesController.irSendGuestDraft);
router.route('/:id/ir-send-sms').post(verifySession, issuesController.irSendSmsDraft);
router.route('/:id/ir-log-note').post(verifySession, issuesController.irLogNote);
router.route('/:id/ir-follow-up').post(verifySession, issuesController.irScheduleFollowUp);
router.route('/:id/thread').get(verifySession, issuesController.getIssueThread);
router.route('/:id/vendor-thread')
    .get(verifySession, issuesController.getIssueVendorThread)
    .post(verifySession, issuesController.attachIssueVendorThread)
    .delete(verifySession, issuesController.unlinkIssueVendorThread);
router.route('/:id/openphone-conversation').get(verifySession, issuesController.resolveIssueOpenPhoneConversation);
router.route('/:id/vendor-thread/reply').post(verifySession, issuesController.replyToIssueVendorThread);


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
router.route('/by-reservations').get(verifySession, issuesController.getIssuesByReservationIds);

router.route('/attachment/:fileName').get(issuesController.getAttachment);

router.route('/unresolved').get(verifySession, issuesController.getUnresolvedIssues);

router.route('/migrate-issues-to-action-items').post(verifySession, validateIssueMigrationToActionItem, issuesController.migrateIssuesToActionItems)

router
    .route('/latestupdates/create')
    .post(
        verifySession,
        fileUpload('issues').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
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
