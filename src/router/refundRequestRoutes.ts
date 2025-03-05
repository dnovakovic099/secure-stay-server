import { RefundRequestController } from "../controllers/RefundRequestController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateRefundRequestStatus, validateSaveRefundRequest, validateUpdateRefundRequest } from "../middleware/validation/refundRequest/refundRequest.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const refundRequestController = new RefundRequestController();

router.route('/')
    .post(
        verifySession,
        fileUpload('refundRequest').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateSaveRefundRequest,
        refundRequestController.saveRefundRequest
    );

router.route('/')
    .put(
        verifySession,
        fileUpload('refundRequest').fields([
            { name: 'attachments', maxCount: 10 }
        ]),
        validateUpdateRefundRequest,
        refundRequestController.updateRefundRequest
    );

router.route('/list').get(verifySession, refundRequestController.getRefundRequestList);

router.route('/:reservationId').get(verifySession, refundRequestController.getRefundRequestByReservationId);

router.route('/updatestatus').put(verifySession, validateRefundRequestStatus, refundRequestController.updateRefundRequestStatus);

export default router;
