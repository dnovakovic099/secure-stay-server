import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { validateGetReviewRequest } from "../middleware/validation/reviews/review.validation";

const router = Router();
const reviewController = new ReviewController();

router.route('/').get(verifySession, validateGetReviewRequest, reviewController.getReviews);

router.route('/syncreviews').get(reviewController.syncReviews);

export default router;