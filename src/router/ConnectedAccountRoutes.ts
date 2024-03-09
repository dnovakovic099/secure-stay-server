import { Router } from 'express';
import { ConnectedAccountController } from '../controllers/ConnectedAccountController';
import { validateSavePmAccountInfoRequest, validateSaveSeamAccountInfoRequest, validateSaveSifelyAccountInfoRequest, validateSaveStripeAccountInfoRequest } from '../middleware/validation/connectedAccount.validation';

const router = Router();
const connectedAccountController = new ConnectedAccountController();

router.route('/savepmaccountinfo').post(validateSavePmAccountInfoRequest, connectedAccountController.savePmAccountInfo);
router.route('/saveseamaccountinfo').post(validateSaveSeamAccountInfoRequest, connectedAccountController.saveSeamAccountInfo);
router.route('/savesifelyaccountinfo').post(validateSaveSifelyAccountInfoRequest, connectedAccountController.saveSifelyAccountInfo);
router.route('/savestripeaccountinfo').post(validateSaveStripeAccountInfoRequest, connectedAccountController.saveStripeAccountInfo);

export default router;