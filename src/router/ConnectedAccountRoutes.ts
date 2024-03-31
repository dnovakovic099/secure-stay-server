import { Router } from 'express';
import { ConnectedAccountController } from '../controllers/ConnectedAccountController';
import { validateSavePmAccountInfoRequest, validateSaveSeamAccountInfoRequest, validateSaveSifelyAccountInfoRequest, validateSaveStripeAccountInfoRequest } from '../middleware/validation/connectedAccount.validation';
import verifySession from '../middleware/verifySession';

const router = Router();
const connectedAccountController = new ConnectedAccountController();

router.route('/savepmaccountinfo').post(verifySession, validateSavePmAccountInfoRequest, connectedAccountController.savePmAccountInfo);
router.route('/saveseamaccountinfo').post(validateSaveSeamAccountInfoRequest, connectedAccountController.saveSeamAccountInfo);
router.route('/savesifelyaccountinfo').post(validateSaveSifelyAccountInfoRequest, connectedAccountController.saveSifelyAccountInfo);
router.route('/savestripeaccountinfo').post(validateSaveStripeAccountInfoRequest, connectedAccountController.saveStripeAccountInfo);
router.route('/getconnectedaccountinfo').get(verifySession, connectedAccountController.getConnectedAccountInfo);

export default router;