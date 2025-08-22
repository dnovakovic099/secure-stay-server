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
            const { fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly, keyword, propertyType } = request.query;

            const { reviewList, totalCount } = await reviewService.getReviews({ fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly, keyword, propertyType });

            return response.status(200).json({
                success: true,
                data: reviewList,
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

            const updatedReview = await reviewService.updateReviewVisibility(reviewVisibility, id, userId);

            return response.status(200).json({
                success: true,
                data: updatedReview
            });
        } catch (error) {
            logger.error("Error updating review visibility:", error);
            return next(error);
        }
    }

    async saveReview(request: CustomRequest, response: Response, next: NextFunction){
        try {
            const reviewService = new ReviewService();
            const { body } = request;
            const userId = request.user.id;

            const savedReview = await reviewService.saveReview(body, userId);

            return response.status(201).json({
                success: true,
                data: savedReview
            });
        } catch (error) {
            logger.error("Error saving review:", error);
            return next(error);
        }
    }

    async getReviewsForCheckout(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewService = new ReviewService();
            const data = await reviewService.getReviewsForCheckout(request.query, userId);
            return response.status(200).json(data);
        } catch (error) {
            logger.error("Error fetching review for checkout:", error);
            return next(error);
        }
    }
}
