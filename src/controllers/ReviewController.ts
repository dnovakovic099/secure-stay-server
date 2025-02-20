import { NextFunction, Request, Response } from "express";
import { ReviewService } from "../services/ReviewService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class ReviewController {

    async getReviews(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const { fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly } = request.query;

            const { reviews, totalCount } = await reviewService.getReviews({ fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly });

            return response.status(200).json({
                success: true,
                data: reviews,
                total: totalCount
            });
        } catch (error) {
            return next(error);
        }
    }

    async syncReviews(request: Request, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            await reviewService.syncReviews();
            return response.status(200).json({
                success: true,
                message: "Review synchronization completed successfully."
            });
        } catch (error) {
            logger.error("Error syncing reviews:", error);
            return next(error);
        }
    }

    async updateReviewVisibility(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const { reviewVisibility } = request.body;
            const { id } = request.params;
            const userId = request.user.id;

            const updatedReview = await reviewService.updateReviewVisibility(reviewVisibility, Number(id), userId);

            return response.status(200).json({
                success: true,
                data: updatedReview
            });
        } catch (error) {
            logger.error("Error updating review visibility:", error);
            return next(error);
        }
    }
}
