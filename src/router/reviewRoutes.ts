import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetReviewRequest, validateSaveReview, validateUpdateReviewVisibilityStatusRequest, validateGetReviewForCheckout, validateUpdateReviewForCheckout } from "../middleware/validation/reviews/review.validation";
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

export default router;