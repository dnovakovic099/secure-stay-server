import { NextFunction, Request, Response } from "express";
import { ReviewDetailService } from "../services/ReviewDetailService";
import { ReviewDiscussionService } from "../services/ReviewDiscussionService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class ReviewDetailController {

    async saveReviewDetails(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewId = request.params.reviewId;
            const reviewDetailService = new ReviewDetailService();
            const discussionService = new ReviewDiscussionService();
            const reviewDetail = await reviewDetailService.saveReviewDetail(reviewId, request.body, userId);
            await discussionService.createSystemMessage(
                reviewId,
                `Review detail created${reviewDetail?.claimResolutionStatus ? ` with status ${reviewDetail.claimResolutionStatus}` : ""}.`,
                { eventType: "review_detail_created", actor: userId }
            );
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
            const reviewId =request.params.reviewId;
            const reviewDetailService = new ReviewDetailService();
            const discussionService = new ReviewDiscussionService();
            const updatedReviewDetail = await reviewDetailService.updateReviewDetail(reviewId, request.body, userId);
            await discussionService.createSystemMessage(
                reviewId,
                `Review detail updated${updatedReviewDetail?.claimResolutionStatus ? ` with status ${updatedReviewDetail.claimResolutionStatus}` : ""}.`,
                { eventType: "review_detail_updated", actor: userId }
            );
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
            const reviewId = request.params.reviewId;
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
