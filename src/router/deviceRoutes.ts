import { DevicesController } from "../controllers/DevicesController";
import { Router } from "express";
import { validateCreatePasscodeRequest, validateDeletePasscodeRequest, validateGetAccessTokenRequest, validateGetPasscodeRequest, validateSaveLockListingRequest } from "../middleware/validation/devices/device.validation";

const router = Router();
const deviceController = new DevicesController();

router.route('/seam/getclientsessiontoken').get(deviceController.getClientSessionToken);

router.route('/seam/createconnectwebview').get(deviceController.createConnectWebView);

router.route('/sifely/getaccesstoken').post(validateGetAccessTokenRequest, deviceController.getAccessToken);

router.route('/sifely/locklist').get(deviceController.getSifelyLocks);

router.route('/sifely/lockinfo/:lockId').get(deviceController.getSifelyLockInfo);

router.route('/sifely/getpasscodes').get(validateGetPasscodeRequest, deviceController.getPassCodesOfSifelyDevice);

router.route('/sifely/createpasscode').post(validateCreatePasscodeRequest, deviceController.createPassCode);

router.route('/sifely/deletepasscode').post(validateDeletePasscodeRequest, deviceController.deletePassCode);

router.route('/getlistings/:lockId').get(deviceController.getDeviceListing);

router.route('/savelocklistinginfo').post(validateSaveLockListingRequest, deviceController.saveLockListingInfo);

export default router;
