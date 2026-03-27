import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetReviewRequest, validateSaveReview, validateUpdateReviewVisibilityStatusRequest, validateGetReviewForCheckout, validateUpdateReviewForCheckout, validateCreateLatestUpdate, validateBadReviewUpdateStatus, validateBadReviewLatestUpdate, validateGetBadReview, validateGetLiveIssues, validateCreateLiveIssue, validateUpdateLiveIssue, validateCreateLiveIssueUpdate } from "../middleware/validation/reviews/review.validation";
import { validateReviewDetailsRequest } from "../middleware/validation/reviews/reviewDetail.validation";
import { ReviewDetailController } from "../controllers/ReviewDetailController";

const router = Router();
const reviewController = new ReviewController();
const reviewDetailController = new ReviewDetailController();

router.route('/ui-settings/:pageKey')
    .get(verifySession, reviewController.getReviewUiSettings.bind(reviewController))
    .put(verifySession, reviewController.updateReviewUiSettings.bind(reviewController));

router.route('/mitigation-statuses')
    .get(verifySession, reviewController.getMitigationStatusOptions.bind(reviewController))
    .post(verifySession, reviewController.createMitigationStatusOption.bind(reviewController))
    .put(verifySession, reviewController.updateMitigationStatusOption.bind(reviewController))
    .delete(verifySession, reviewController.deleteMitigationStatusOption.bind(reviewController));

router.route('/reviewdiscussion/:reviewId')
    .get(verifySession, reviewController.getReviewDiscussion.bind(reviewController))
    .post(verifySession, reviewController.createReviewDiscussionMessage.bind(reviewController));

router.route('/reviewdiscussion/:reviewId/reactions')
    .post(verifySession, reviewController.toggleReviewDiscussionReaction.bind(reviewController));

router.route('/')
    .get(verifySession, validateGetReviewRequest, reviewController.getReviews.bind(reviewController))
    .post(verifySession, validateSaveReview, reviewController.saveReview.bind(reviewController))

router.route('/syncreviews').get(reviewController.syncReviews.bind(reviewController));

router.route('/reviewvisibility/:id').put(verifySession, validateUpdateReviewVisibilityStatusRequest, reviewController.updateReviewVisibility.bind(reviewController))

router
    .route('/reviewdetails/:reviewId')
    .post(verifySession, validateReviewDetailsRequest, reviewDetailController.saveReviewDetails)
    .put(verifySession, validateReviewDetailsRequest, reviewDetailController.updateReviewDetails)
    .get(verifySession, reviewDetailController.getReviewDetails);

router.route('/reviewcheckout')
    .get(verifySession, validateGetReviewForCheckout, reviewController.getReviewsForCheckout.bind(reviewController))

router.route('/reviewcheckout/update').put(verifySession, validateUpdateReviewForCheckout, reviewController.updateReviewCheckout.bind(reviewController))

router.route('/reviewcheckout/latest-update/create').post(verifySession,validateCreateLatestUpdate, reviewController.createReviewCheckoutUpdate.bind(reviewController));

router.route('/liveissues')
    .get(verifySession, validateGetLiveIssues, reviewController.getLiveIssues.bind(reviewController))
    .post(verifySession, validateCreateLiveIssue, reviewController.createLiveIssue.bind(reviewController))

router.route('/liveissues/update').put(verifySession, validateUpdateLiveIssue, reviewController.updateLiveIssue.bind(reviewController))

router.route('/liveissues/latest-update/create').post(verifySession, validateCreateLiveIssueUpdate, reviewController.createLiveIssueUpdate.bind(reviewController))

router.route('/bad-review/update-status').put(verifySession, validateBadReviewUpdateStatus, reviewController.updateBadReviewStatus.bind(reviewController));

router.route('/bad-review/update-fields').put(verifySession, reviewController.updateBadReviewFields.bind(reviewController));

router.route('/bad-review/latest-update/create').post(verifySession, validateBadReviewLatestUpdate, reviewController.createBadReviewUpdate.bind(reviewController));

router.route('/bad-review')
    .get(verifySession, validateGetBadReview, reviewController.getBadReview.bind(reviewController))

router.route('/dashboard').get(verifySession, reviewController.getDashboardStats.bind(reviewController));

export default router;
