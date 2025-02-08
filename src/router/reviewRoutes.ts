import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetReviewRequest } from "../middleware/validation/reviews/review.validation";
import { validateReviewDetailsRequest } from "../middleware/validation/reviews/reviewDetail.validation";
import { ReviewDetailController } from "../controllers/ReviewDetailController";

const router = Router();
const reviewController = new ReviewController();
const reviewDetailController = new ReviewDetailController();

router.route('/').get(verifySession, validateGetReviewRequest, reviewController.getReviews);

router.route('/syncreviews').get(reviewController.syncReviews);

router
    .route('/reviewdetails/:reviewId')
    .post(verifySession, validateReviewDetailsRequest, reviewDetailController.saveReviewDetails)
    .put(verifySession, validateReviewDetailsRequest, reviewDetailController.updateReviewDetails)
    .get(verifySession, reviewDetailController.getReviewDetails);

export default router;