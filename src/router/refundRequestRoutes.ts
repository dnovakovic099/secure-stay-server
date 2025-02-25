import { RefundRequestController } from "../controllers/RefundRequestController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateSaveRefundRequest, validateUpdateRefundRequest } from "../middleware/validation/refundRequest/refundRequest.validation";
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

router.route('/:reservationId').get(verifySession, refundRequestController.getRefundRequestByReservationId);

router.route('/list').get(verifySession, refundRequestController.getRefundRequestList);

export default router;
