import { ReviewService } from "../services/ReviewService";
import logger from "../utils/logger.utils";

export async function syncReviews() {
    logger.info("Syncing reviews...");
    const reviewServices = new ReviewService();
    await reviewServices.syncHostifyReviews();
    logger.info("Review synchronization completed successfully.");
}