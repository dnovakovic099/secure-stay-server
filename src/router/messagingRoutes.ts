import { Router } from 'express';
import { validateSaveEmailInfoRequest, validateSavePhoneNoInfoRequest, validateUpdatePhoneNoInfoRequest } from '../middleware/validation/messaging.validation';
import { MessagingController } from '../controllers/MessagingController';

const router = Router();
const messagingController = new MessagingController();

router.route('/saveemailinfo').post(validateSaveEmailInfoRequest, messagingController.saveEmailInfo);
router.route('/deleteemailinfo/:id').delete(messagingController.deleteEmailInfo);

router.route('/savephonenoinfo').post(validateSavePhoneNoInfoRequest, messagingController.savePhoneNoInfo);
router.route('/deletephonenoinfo/:id').delete(messagingController.deletePhoneNoInfo);
router.route('/updatephonenoinfo').put(validateUpdatePhoneNoInfoRequest, messagingController.updatePhoneNoInfo);

export default router


