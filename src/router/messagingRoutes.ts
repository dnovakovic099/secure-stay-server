import { Router } from 'express';
import { validateSaveEmailInfoRequest, validateSavePhoneNoInfoRequest, validateSupportMessageRequest, validateUpdatePhoneNoInfoRequest } from '../middleware/validation/messaging.validation';
import { MessagingController } from '../controllers/MessagingController';
import verifyMobileSession from '../middleware/verifyMobileSession';

const router = Router();
const messagingController = new MessagingController();

router.route('/saveemailinfo').post(validateSaveEmailInfoRequest, messagingController.saveEmailInfo);
router.route('/deleteemailinfo/:id').delete(messagingController.deleteEmailInfo);
router.route('/getemaillist').get(messagingController.getEmailList);

router.route('/savephonenoinfo').post(validateSavePhoneNoInfoRequest, messagingController.savePhoneNoInfo);
router.route('/deletephonenoinfo/:id').delete(messagingController.deletePhoneNoInfo);
router.route('/updatephonenoinfo').put(validateUpdatePhoneNoInfoRequest, messagingController.updatePhoneNoInfo);
router.route('/getphonenolist').get(messagingController.getPhoneNoList);

router.route('/supportmessage').post(verifyMobileSession, validateSupportMessageRequest, messagingController.sendSupportMessage);

export default router


