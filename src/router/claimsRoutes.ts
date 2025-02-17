import { Router } from "express";
import { ClaimsController } from "../controllers/ClaimsController";
import verifySession from "../middleware/verifySession";
import { validateCreateClaim, validateUpdateClaim } from "../middleware/validation/claims/claims.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const claimsController = new ClaimsController();

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

router.route('/:id')
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

router.route('/export')
    .get(
        verifySession,
        claimsController.exportClaimsToExcel
    );

export default router;