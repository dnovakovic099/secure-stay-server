import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ListingIntakeController } from "../controllers/ListingIntakeController";
import { validateCreateBedTypes, validateCreateListingIntake, validateDeleteBedTypes, validateGetListingIntake, validateUpdateBedTypes, validateUpdateListingIntake } from "../middleware/validation/listings/listingIntake.validation";
const router = Router();

const listingIntakeController = new ListingIntakeController();

router.route('/create').post(verifySession, validateCreateListingIntake, listingIntakeController.createListingIntake);
router.route('/update').put(verifySession, validateUpdateListingIntake, listingIntakeController.updateListingIntake);
router.route('/delete/:id').delete(verifySession, listingIntakeController.deleteListingIntake);
router.route('/').get(verifySession, validateGetListingIntake, listingIntakeController.getListingIntake);
router.route('/:id').get(verifySession, listingIntakeController.getListingIntakeById)

router.route('/bedTypes/create').post(verifySession, validateCreateBedTypes, listingIntakeController.saveBedTypes);
router.route('/bedTypes/update').put(verifySession, validateUpdateBedTypes, listingIntakeController.updateBedTypes);
router.route('/bedTypes/').delete(verifySession, validateDeleteBedTypes, listingIntakeController.deleteBedTypes);
router.route('/bedTypes/:listingIntakeId').post(verifySession, listingIntakeController.getBedTypes);

export default router;