import { ListingController } from "../controllers/ListingController"
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetListingScore, validateSaveListingScore } from "../middleware/validation/listings/listing.validation";

const router = Router();
const listingController = new ListingController();

router.route('/getlistings').get(verifySession, listingController.getListings);

router.route('/getlisting/:listing_id').get(verifySession, listingController.getListingById);

router.route('/synchostawaylistings').get(verifySession, listingController.syncHostawayListing);

router.route('/getlistingaddresses').get(verifySession, listingController.getListingAddresses);

router.route('/savelisitngscore').post(
  verifySession,
  validateSaveListingScore,
  listingController.saveListingScore
);

router.route('/getlistingscore').get(
  verifySession,
  validateGetListingScore,
  listingController.getListingScore
)

export default router;
