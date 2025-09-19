import { Router } from "express";
import { ClientController } from "../controllers/ClientController";
import verifySession from "../middleware/verifySession";
import { validateCreateClient, validateUpdateClient, validateGetClients, validateCreatePropertyOnboarding, validateUpdatePropertyOnboarding, validateSaveOnboardingDetails, validateUpdateOnboardingDetails } from "../middleware/validation/Client/client.validation";

const router = Router();
const clientController = new ClientController();

router.route('/create').post(verifySession, validateCreateClient, clientController.createClient.bind(clientController));
router.route('/update').put(verifySession, validateUpdateClient, clientController.updateClient.bind(clientController));
router.route('/').get(verifySession, validateGetClients, clientController.getClients.bind(clientController));
router.route('/:id').delete(verifySession, clientController.deleteClient.bind(clientController));

//sales representative form apis
router.route('/sales/pre-onboarding').post(verifySession, validateCreatePropertyOnboarding, clientController.savePropertyPreOnboardingInfo.bind(clientController));
router.route('/sales/pre-onboarding').put(verifySession, validateUpdatePropertyOnboarding, clientController.updatePropertyPreOnboardingInfo.bind(clientController));
router.route('/sales/pre-onboarding/:clientId').get(verifySession, clientController.getPropertyPreOnboardingInfo.bind(clientController));

//internal form apis
router.route('/internal/onboarding').post(verifySession, validateSaveOnboardingDetails, clientController.saveOnboardingDetails.bind(clientController));
router.route('/internal/onboarding').put(verifySession, validateUpdateOnboardingDetails, clientController.updatedOnboardingDetails.bind(clientController));


export default router;
