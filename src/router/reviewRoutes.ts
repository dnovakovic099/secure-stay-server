import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetReviewRequest, validateSaveReview, validateUpdateReviewVisibilityStatusRequest, validateGetReviewForCheckout, validateUpdateReviewForCheckout, validateCreateLatestUpdate, validateBadReviewUpdateStatus, validateBadReviewLatestUpdate, validateGetBadReview, validateGetLiveIssues, validateCreateLiveIssue, validateUpdateLiveIssue, validateCreateLiveIssueUpdate } from "../middleware/validation/reviews/review.validation";
import { validateReviewDetailsRequest } from "../middleware/validation/reviews/reviewDetail.validation";
import { ReviewDetailController } from "../controllers/ReviewDetailController";

const router = Router();
const reviewController = new ReviewController();
const reviewDetailController = new ReviewDetailController();

router.route('/')
    .get(verifySession, validateGetReviewRequest, reviewController.getReviews)
    .post(verifySession, validateSaveReview, reviewController.saveReview)

router.route('/syncreviews').get(reviewController.syncReviews);

router.route('/reviewvisibility/:id').put(verifySession, validateUpdateReviewVisibilityStatusRequest, reviewController.updateReviewVisibility)

router
    .route('/reviewdetails/:reviewId')
    .post(verifySession, validateReviewDetailsRequest, reviewDetailController.saveReviewDetails)
    .put(verifySession, validateReviewDetailsRequest, reviewDetailController.updateReviewDetails)
    .get(verifySession, reviewDetailController.getReviewDetails);

router.route('/reviewcheckout')
    .get(verifySession, validateGetReviewForCheckout, reviewController.getReviewsForCheckout)

router.route('/reviewcheckout/update').put(verifySession, validateUpdateReviewForCheckout, reviewController.updateReviewCheckout)

router.route('/reviewcheckout/latest-update/create').post(verifySession,validateCreateLatestUpdate, reviewController.createReviewCheckoutUpdate);

router.route('/liveissues')
    .get(verifySession, validateGetLiveIssues, reviewController.getLiveIssues)
    .post(verifySession, validateCreateLiveIssue, reviewController.createLiveIssue)

router.route('/liveissues/update').put(verifySession, validateUpdateLiveIssue, reviewController.updateLiveIssue)

router.route('/liveissues/latest-update/create').post(verifySession, validateCreateLiveIssueUpdate, reviewController.createLiveIssueUpdate)

router.route('/bad-review/update-status').put(verifySession, validateBadReviewUpdateStatus, reviewController.updateBadReviewStatus);

router.route('/bad-review/latest-update/create').post(verifySession, validateBadReviewLatestUpdate, reviewController.createBadReviewUpdate);

router.route('/bad-review')
    .get(verifySession, validateGetBadReview, reviewController.getBadReview)

export default router;