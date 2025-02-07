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
            const { fromDate, toDate, listingId, page, limit } = request.query;

            const { reviews, totalCount } = await reviewService.getReviews(
                String(fromDate),
                String(toDate),
                Number(listingId),
                Number(page),
                Number(limit)
            );

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
}
