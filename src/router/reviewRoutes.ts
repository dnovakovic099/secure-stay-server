import { ReviewController } from "../controllers/ReviewController";
import { Router } from "express";
import verifySession from "../middleware/verifySession";

const router = Router();
const reviewController = new ReviewController();

router.route('/').get(verifySession, reviewController.getReviews);

router.route('/syncreviews').get(reviewController.syncReviews);

export default router;