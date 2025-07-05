import { ListingController } from "../controllers/ListingController"
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetListingScore, validateSaveListingDetail, validateSaveListingScore, validateSaveListingUpdate } from "../middleware/validation/listings/listing.validation";
import verifyMobileSession from "../middleware/verifyMobileSession";

const router = Router();
const listingController = new ListingController();

router.route('/getlistings').get(verifySession, listingController.getListings);

router.route('/getlisting/:listing_id').get(verifySession, listingController.getListingById);

router.route('/synchostawaylistings').get(verifySession, listingController.syncHostawayListing);

router.route('/getlistingaddresses').get(verifySession, listingController.getListingAddresses);

router.route('/savelistingscore').post(
  verifySession,
  validateSaveListingScore,
  listingController.saveListingScore
);

router.route('/getlistingscore').get(
  verifySession,
  validateGetListingScore,
  listingController.getListingScore
)

router.route('/getlistingnames')
  .get(
    verifySession,
    listingController.getListingNames
  )

router.route('/savelistingupdate')
  .post(
    verifySession,
    validateSaveListingUpdate,
    listingController.saveListingUpdate
  );

router.route('/getlistingupdates/:listingId')
  .get(
    verifySession,
    listingController.getListingUpdates
  )

router.route('/savelistingdetails')
  .post(
    verifySession,
    validateSaveListingDetail,
    listingController.saveListingDetails
  );

router.route('/getlistingdetail')
  .get(
    verifySession,
    listingController.getListingDetail
  )

router.route('/getupdates/:listingId')
  .get(
    verifyMobileSession,
    listingController.getListingUpdates
  )

router.route('/getpmlistings')
.get(
  verifySession,
  listingController.getPmListings
)


export default router;
