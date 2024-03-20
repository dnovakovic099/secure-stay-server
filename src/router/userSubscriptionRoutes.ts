import { Router } from 'express';
import { UserSubscriptionController } from '../controllers/UserSubscriptionController';
import { validateCreateCheckoutSessionRequest } from '../middleware/validation/subscription.validation';
import verifySession from '../middleware/verifySession';

const router = Router();
const userSubscriptionController = new UserSubscriptionController();

router.route('/createcheckoutsession').post(verifySession, validateCreateCheckoutSessionRequest, userSubscriptionController.createUserSubscriptionCheckoutSession);

router.route('/saveusersubscriptioninfo').post(verifySession, userSubscriptionController.saveUserSubscriptionInfo);

router.route('/getusersubscriptioninfo').get(verifySession, userSubscriptionController.getUserSubscriptionInfo);

router.route('/getuserinvoices').get(verifySession, userSubscriptionController.getUserInvoices);

router.route('/getuserupcominginvoice').get(verifySession)

export default router;