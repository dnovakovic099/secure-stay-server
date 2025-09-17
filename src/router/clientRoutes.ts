import { Router } from "express";
import { ClientController } from "../controllers/ClientController";
import verifySession from "../middleware/verifySession";
import { validateCreateClient, validateUpdateClient, validateGetClients, validateCreatePropertyOnboarding } from "../middleware/validation/Client/client.validation";

const router = Router();
const clientController = new ClientController();

router.route('/create').post(verifySession, validateCreateClient, clientController.createClient.bind(clientController));
router.route('/update').put(verifySession, validateUpdateClient, clientController.updateClient.bind(clientController));
router.route('/').get(verifySession, validateGetClients, clientController.getClients.bind(clientController));
router.route('/:id').delete(verifySession, clientController.deleteClient.bind(clientController));

//sales representative form apis
router.route('/sales/pre-onboarding').post(verifySession, validateCreatePropertyOnboarding, clientController.savePropertyPreOnboardingInfo.bind(clientController));
router.route('/sales/pre-onboarding/:clientId').get(verifySession, clientController.getPropertyPreOnboardingInfo.bind(clientController));


export default router;
