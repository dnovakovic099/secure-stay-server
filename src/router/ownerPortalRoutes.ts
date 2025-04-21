import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { PartnershipInfoController } from "../controllers/OwnerPortalController";
import { validateSavePartnershipInfo } from "../middleware/validation/ownerPortal.validation";

const router = Router();
const partnershipInfoController = new PartnershipInfoController();

router.route('/savepartnershipinfo')
    .post(
        verifySession,
        validateSavePartnershipInfo,
        partnershipInfoController.savePartnershipInfo
    );

router.route('/getpartnershipinfo')
    .get(
        verifySession,
        partnershipInfoController.getPartnershipInfo
    );

export default router;
