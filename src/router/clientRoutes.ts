import { Router } from "express";
import { ClientController } from "../controllers/ClientController";
import verifySession from "../middleware/verifySession";
import { validateCreateClient, validateCreateClientWithPreOnboarding, validateUpdateClient, validateGetClients, validateCreatePropertyOnboarding, validateUpdatePropertyOnboarding, validateSaveOnboardingDetails, validateUpdateOnboardingDetails, validateSaveServiceInfo, validateUpdateServiceInfo, validateSaveListingInfo, validateUpdateListingInfo, validateSaveOnboardingDetailsClientForm, validateSaveListingDetailsClientForm, validateUpdateOnboardingDetailsClientForm, validateUpdateListingDetailsClientForm, validateUpdateFinancialsInternalForm, validateUpdateManagementInternalForm, validateSubmitAllClientForms } from "../middleware/validation/Client/client.validation";
import fileUpload from "../utils/upload.util";

const router = Router();
const clientController = new ClientController();

router.route('/create').post(verifySession, validateCreateClient, clientController.createClient.bind(clientController));
router.route('/update').put(verifySession, validateUpdateClient, clientController.updateClient.bind(clientController));
router.route('/').get(verifySession, validateGetClients, clientController.getClients.bind(clientController));
router.route('/check-existing-client').get(verifySession, clientController.checkExistingClient.bind(clientController));
router.route('/get-client-details/:id').get(verifySession, clientController.getClientDetails.bind(clientController));
router.route('/:id').delete(verifySession, clientController.deleteClient.bind(clientController));
router.route('/property/:propertyId').delete(verifySession, clientController.deleteProperty.bind(clientController));

//sales representative form apis
router.route('/sales/create-with-pre-onboarding').post(verifySession, validateCreateClientWithPreOnboarding, clientController.createClientWithPreOnboarding.bind(clientController));
router.route('/sales/pre-onboarding').post(verifySession, validateCreatePropertyOnboarding, clientController.savePropertyPreOnboardingInfo.bind(clientController));
router.route('/sales/pre-onboarding').put(verifySession, validateUpdatePropertyOnboarding, clientController.updatePropertyPreOnboardingInfo.bind(clientController));
router.route('/sales/pre-onboarding/:clientId').get(verifySession, clientController.getPropertyPreOnboardingInfo.bind(clientController));

router.route('/sales/representative-list').get(verifySession, clientController.getSalesRepresentativeList.bind(clientController));

//internal form apis
router.route('/internal/onboarding').post(verifySession, validateSaveOnboardingDetails, clientController.saveOnboardingDetails.bind(clientController));
router.route('/internal/onboarding').put(verifySession, validateUpdateOnboardingDetails, clientController.updatedOnboardingDetails.bind(clientController));

router.route('/internal/service-info').post(verifySession, validateSaveServiceInfo, clientController.saveServiceInfo.bind(clientController));
router.route('/internal/service-info').put(verifySession, validateUpdateServiceInfo, clientController.updateServiceInfo.bind(clientController));

// router.route('/internal/listing-info').post(verifySession, validateSaveListingInfo, clientController.saveListingInfo.bind(clientController));
router.route('/internal/management').put(verifySession, validateUpdateManagementInternalForm, clientController.updateManagementInternalForm.bind(clientController));
router.route('/internal/listing-info').put(verifySession, validateUpdateListingInfo, clientController.updateListingInfo.bind(clientController));

router.route('/internal/finacials').put(verifySession, validateUpdateFinancialsInternalForm, clientController.updateFinancialsInternalForm.bind(clientController));

//client form apis
router.route('/client-facing/onboarding').post(verifySession, validateSaveOnboardingDetailsClientForm, clientController.saveOnboardingDetailsClientForm.bind(clientController));
router.route('/client-facing/onboarding').put(verifySession, validateUpdateOnboardingDetailsClientForm, clientController.updateOnboardingDetailsClientForm.bind(clientController));

// router.route('/client-facing/listing-info').post(verifySession, validateSaveListingDetailsClientForm, clientController.saveListingDetailsClientForm.bind(clientController));
router.route('/client-facing/listing-info').put(verifySession, validateUpdateListingDetailsClientForm, clientController.updateListingDetailsClientForm.bind(clientController));
router.route('/client-facing/submit-all').post(verifySession, validateSubmitAllClientForms, clientController.submitAllClientForms.bind(clientController));



router.route('/publish-property-to-hostify/:propertyId').post(verifySession, clientController.publishPropertyToHostify.bind(clientController));
router.route('/publish-property/:propertyId').get(verifySession, clientController.publishPropertyToHostaway.bind(clientController));


router
    .route('/upload-csv')
    .post(
        verifySession,
        fileUpload("clients").single("file"),
        clientController.processCSVForClient.bind(clientController)
    );
export default router;
