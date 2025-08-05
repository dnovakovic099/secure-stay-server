import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ListingScheduleController } from "../controllers/ListingScheduleController";
import { validateCreateListingSchedule, validateGetListingScheduleByListingId, validateUpdateListingSchedule } from "../middleware/validation/listings/listingSchedule.validation";
const router = Router();

const listingScheduleController = new ListingScheduleController();

router.route('/create').post(verifySession, validateCreateListingSchedule, listingScheduleController.createListingSchedule);
router.route('/update').put(verifySession, validateUpdateListingSchedule, listingScheduleController.updateListingSchedule);
router.route('/delete/:id').delete(verifySession, listingScheduleController.deleteListingSchedule);
router.route('/listing/').post(verifySession, validateGetListingScheduleByListingId, listingScheduleController.getListingSchedulesByListingId);
router.route('/getschedule/:id').get(verifySession, listingScheduleController.getListingScheduleById);

export default router;