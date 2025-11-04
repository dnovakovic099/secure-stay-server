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
            const { fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly, keyword, propertyType, dateType, channel } = request.query;

            const { reviewList, totalCount } = await reviewService.getReviews({ fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly, keyword, propertyType, dateType, channel });

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

    async updateReviewCheckout(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const { id, status, comments, isActive } = request.body;
            const userId = request.user.id;

            const updatedReviewCheckout = await reviewService.updateReviewCheckout(id, status, comments, userId, isActive);

            return response.status(200).json({
                success: true,
                data: updatedReviewCheckout
            });
        } catch (error) {
            logger.error("Error updating review checkout status:", error);
            return next(error);
        }
    }

    async createReviewCheckoutUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const userId = request.user.id;
            const { reviewCheckoutId, updates } = request.body;

            const newUpdate = await reviewService.createReviewCheckoutUpdate(reviewCheckoutId, updates, userId);

            return response.status(201).json({
                success: true,
                data: newUpdate
            });
        } catch (error) {
            logger.error("Error creating review checkout update:", error);
            return next(error);
        }
    }

    async getBadReview(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewService = new ReviewService();
            const data = await reviewService.getBadReviews(request.query, userId);
            return response.status(200).json(data);
        } catch (error) {
            logger.error("Error fetching bad review:", error);
            return next(error);
        }
    }

    async updateBadReviewStatus(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();

            const { status, badReviewId } = request.body;
            const userId = request.user.id;

            const updatedBadReview = await reviewService.updateBadReviewStatus(badReviewId, status, userId);

            return response.status(200).json({
                success: true,
                data: updatedBadReview
            });
        } catch (error) {
            logger.error("Error updating bad review status:", error);
            return next(error);
        }
    }


    async createBadReviewUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const userId = request.user.id;
            const { badReviewId, updates } = request.body;

            const newUpdate = await reviewService.createBadReviewUpdate(badReviewId, updates, userId);

            return response.status(201).json({
                success: true,
                data: newUpdate
            });
        } catch (error) {
            logger.error("Error creating bad review update:", error);
            return next(error);
        }
    }

    async getLiveIssues(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const reviewService = new ReviewService();
            const { page, limit, propertyId, keyword, status, tab, assignee } = request.query;
            
            const filters = {
                page: Number(page) || 1,
                limit: Number(limit) || 10,
                propertyId: propertyId ? (Array.isArray(propertyId) ? propertyId.map(id => Number(id)) : [Number(propertyId)]) : undefined,
                keyword: keyword ? String(keyword) : undefined,
                status: status ? (Array.isArray(status) ? status.map(s => String(s)) : [String(status)]) : undefined,
                tab: tab ? String(tab) : undefined,
                assignee: assignee ? String(assignee) : undefined,
            };

            const data = await reviewService.getLiveIssues(filters, userId);
            return response.status(200).json({
                success: true,
                data: data.result,
                total: data.total
            });
        } catch (error) {
            logger.error("Error fetching live issues:", error);
            return next(error);
        }
    }

    async createLiveIssue(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const userId = request.user.id;
            const { status, assignee, propertyId, summary, comments, followUp } = request.body;

            const newLiveIssue = await reviewService.createLiveIssue({
                status,
                assignee,
                propertyId,
                summary,
                comments,
                followUp,
            }, userId);

            return response.status(201).json({
                success: true,
                data: newLiveIssue
            });
        } catch (error) {
            logger.error("Error creating live issue:", error);
            return next(error);
        }
    }

    async updateLiveIssue(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const userId = request.user.id;
            const { id, status, assignee, propertyId, summary, comments, followUp } = request.body;

            const updatedLiveIssue = await reviewService.updateLiveIssue(Number(id), {
                status,
                assignee,
                propertyId,
                summary,
                comments,
                followUp,
            }, userId);

            return response.status(200).json({
                success: true,
                data: updatedLiveIssue
            });
        } catch (error) {
            logger.error("Error updating live issue:", error);
            return next(error);
        }
    }

    async createLiveIssueUpdate(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reviewService = new ReviewService();
            const userId = request.user.id;
            const { liveIssueId, updates } = request.body;

            const newUpdate = await reviewService.createLiveIssueUpdate(liveIssueId, updates, userId);

            return response.status(201).json({
                success: true,
                data: newUpdate
            });
        } catch (error) {
            logger.error("Error creating live issue update:", error);
            return next(error);
        }
    }
}
