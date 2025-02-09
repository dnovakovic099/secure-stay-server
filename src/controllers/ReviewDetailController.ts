import { NextFunction, Request, Response } from "express";
import { ReviewDetailService } from "../services/ReviewDetailService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class ReviewDetailController {

    async saveReviewDetails(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewId = Number(request.params.reviewId);
            const reviewDetailService = new ReviewDetailService();
            const reviewDetail = await reviewDetailService.saveReviewDetail(reviewId, request.body, userId);
            return response.status(201).json({
                success: true,
                data: reviewDetail
            });
        } catch (error) {
            return next(error);
        }
    }

    async updateReviewDetails(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewId = Number(request.params.reviewId);
            const reviewDetailService = new ReviewDetailService();
            const updatedReviewDetail = await reviewDetailService.updateReviewDetail(reviewId, request.body, userId);
            return response.status(200).json({
                success: true,
                data: updatedReviewDetail
            });
        } catch (error) {
            return next(error);
        }
    }

    async getReviewDetails(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewId = Number(request.params.reviewId);
            const reviewDetailService = new ReviewDetailService();
            const reviewDetail = await reviewDetailService.getReviewDetail(reviewId);
            return response.status(200).json({
                success: true,
                data: reviewDetail
            });
        } catch (error) {
            return next(error);
        }
    }

}
