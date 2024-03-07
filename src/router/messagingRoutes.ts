import { Router } from 'express';
import { validateSaveEmailInfoRequest } from '../middleware/validation/messaging.validation';
import { MessagingController } from '../controllers/MessagingController';

const router = Router();
const messagingController = new MessagingController();

router.route('/saveemailinfo').post(validateSaveEmailInfoRequest, messagingController.saveEmailInfo);

router.route('/deleteemailinfo/:id').delete(messagingController.deleteEmailInfo);

export default router


