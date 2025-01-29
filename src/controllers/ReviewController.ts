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
            const userId = request.user.id;
            const listingId = request.query.listingId;
            const reviews = await reviewService.getReviews(userId, Number(listingId));
            return response.status(200).json({
                success: true,
                data: reviews
            });
        } catch (error) {
            return next(error);
        }
    }
}
