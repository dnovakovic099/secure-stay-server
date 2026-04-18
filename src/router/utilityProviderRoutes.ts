import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { UtilityProviderController } from "../controllers/UtilityProviderController";
import {
    validateCreateUtilityProvider,
    validateUpdateUtilityProvider,
    validateGetUtilityProviders,
    validateUtilityPaymentMethod,
    validateUtilityManagedOption,
    validateGetUtilityManagedOptions,
} from "../middleware/validation/utility/utility.validation";

const router = Router();
const controller = new UtilityProviderController();

router.route("/")
    .get(verifySession, validateGetUtilityProviders, controller.getUtilityProviders.bind(controller))
    .post(verifySession, validateCreateUtilityProvider, controller.createUtilityProvider.bind(controller));

router.route("/listing/:listingId")
    .get(verifySession, controller.getUtilityProvidersByListing.bind(controller));

router.route("/payment-methods")
    .get(verifySession, controller.getUtilityPaymentMethods.bind(controller))
    .post(verifySession, validateUtilityPaymentMethod, controller.createUtilityPaymentMethod.bind(controller));

router.route("/payment-methods/:id")
    .put(verifySession, validateUtilityPaymentMethod, controller.updateUtilityPaymentMethod.bind(controller))
    .delete(verifySession, controller.deleteUtilityPaymentMethod.bind(controller));

router.route("/managed-options/:kind")
    .get(verifySession, validateGetUtilityManagedOptions, controller.getUtilityManagedOptions.bind(controller))
    .post(verifySession, validateGetUtilityManagedOptions, validateUtilityManagedOption, controller.createUtilityManagedOption.bind(controller));

router.route("/managed-options/:kind/:id")
    .put(verifySession, validateGetUtilityManagedOptions, validateUtilityManagedOption, controller.updateUtilityManagedOption.bind(controller))
    .delete(verifySession, validateGetUtilityManagedOptions, controller.deleteUtilityManagedOption.bind(controller));

router.route("/:id")
    .put(verifySession, validateUpdateUtilityProvider, controller.updateUtilityProvider.bind(controller))
    .delete(verifySession, controller.deleteUtilityProvider.bind(controller));

export default router;
