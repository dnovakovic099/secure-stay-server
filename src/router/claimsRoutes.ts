import { Router } from "express";
import multer from "multer";
import { ClaimsController } from "../controllers/ClaimsController";
import verifySession from "../middleware/verifySession";
import { validateCreateClaim, validateUpdateClaim, validateBulkUpdateClaims } from "../middleware/validation/claims/claims.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const claimsController = new ClaimsController();
const claimSuggestionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.route('/report-metadata')
    .get(
        verifySession,
        claimsController.getReportMetadata
    );

router.route('/reservation-candidates')
    .get(
        verifySession,
        claimsController.getReservationCandidates
    );

router.route('/ai-suggest-entries')
    .post(
        verifySession,
        claimSuggestionUpload.fields([{ name: 'attachments', maxCount: 20 }]),
        claimsController.suggestClaimEntries
    );

router.route('/')
    .get(
        verifySession,
        claimsController.getClaims
    )
    .post(
        verifySession,
        fileUpload('claims').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateCreateClaim,
        claimsController.createClaim
    );

router.route('/bulk-update')
    .put(
        verifySession,
        validateBulkUpdateClaims,
        claimsController.bulkUpdateClaims
    );

router.route('/export')
    .get(
        verifySession,
        claimsController.exportClaimsToExcel
    );

router.route('/attachment/:fileName').get(claimsController.getAttachment);

router.route('/migratefilestodrive').get(verifySession, claimsController.migrateFilesToDrive);

router.route('/:id')
    .get(
        verifySession,
        claimsController.getClaimDetail
    )
    .put(
        verifySession,
        fileUpload('claims').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateUpdateClaim,
        claimsController.updateClaim
    )
    .delete(
        verifySession,
        claimsController.deleteClaim
    );

router.route('/:id/discussion')
    .get(
        verifySession,
        claimsController.getClaimDiscussion
    )
    .post(
        verifySession,
        fileUpload('claims').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        claimsController.postClaimDiscussion
    );

router.route('/:id/thread')
    .get(
        verifySession,
        claimsController.getClaimThreadInfo
    )
    .post(
        verifySession,
        claimsController.ensureClaimThread
    );
export default router;
