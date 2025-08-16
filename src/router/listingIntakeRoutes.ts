import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ListingIntakeController } from "../controllers/ListingIntakeController";
import { validateCreateListingIntake, validateGetListingIntake, validateUpdateListingIntake } from "../middleware/validation/listings/listingIntake.validation";
const router = Router();

const listingIntakeController = new ListingIntakeController();

router.route('/create').post(verifySession, validateCreateListingIntake, listingIntakeController.createListingIntake);
router.route('/update').put(verifySession, validateUpdateListingIntake, listingIntakeController.updateListingIntake);
router.route('/delete/:id').delete(verifySession, listingIntakeController.deleteListingIntake);
router.route('/').get(verifySession, validateGetListingIntake, listingIntakeController.getListingIntake);

export default router;