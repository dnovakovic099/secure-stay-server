import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { UtilityProviderController } from "../controllers/UtilityProviderController";
import {
    validateCreateUtilityProvider,
    validateUpdateUtilityProvider,
    validateGetUtilityProviders,
} from "../middleware/validation/utility/utility.validation";

const router = Router();
const controller = new UtilityProviderController();

router.route("/")
    .get(verifySession, validateGetUtilityProviders, controller.getUtilityProviders.bind(controller))
    .post(verifySession, validateCreateUtilityProvider, controller.createUtilityProvider.bind(controller));

router.route("/listing/:listingId")
    .get(verifySession, controller.getUtilityProvidersByListing.bind(controller));

router.route("/:id")
    .put(verifySession, validateUpdateUtilityProvider, controller.updateUtilityProvider.bind(controller))
    .delete(verifySession, controller.deleteUtilityProvider.bind(controller));

export default router;
