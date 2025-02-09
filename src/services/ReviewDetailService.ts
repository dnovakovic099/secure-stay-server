import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import { ReservationInfoService } from "./ReservationInfoService";
import CustomErrorHandler from "../middleware/customError.middleware";

export class ReviewDetailService {
    private reviewDetailRepository = appDatabase.getRepository(ReviewDetailEntity);
    private reviewRepository = appDatabase.getRepository(ReviewEntity);

    public async saveReviewDetail(reviewId: number, details: Partial<ReviewDetailEntity>, userId: string) {
        try {
            // Check if review exists
            const review = await this.reviewRepository.findOne({ where: { id: reviewId } });
            if (!review) {
                throw CustomErrorHandler.notFound(`Review with ID ${reviewId} not found`);
            }

            // Check if details already exist for this review
            const existingDetail = await this.reviewDetailRepository.findOne({ where: { reviewId } });
            if (existingDetail) {
                throw CustomErrorHandler.alreadyExists(`Review detail already exists for review ID ${reviewId}`);
            }

            const reservationInfoService = new ReservationInfoService();
            const reservation = await reservationInfoService.getReservationById(review.reservationId);

            // Create new ReviewDetailEntity instance
            const reviewDetail = this.reviewDetailRepository.create({
                ...details,
                guestEmail: reservation?.guestEmail || '',
                guestPhone: reservation?.phone || '',
                bookingAmount: reservation?.totalPrice,
                reviewId,
                review,
                createdBy: userId
            });

            // Save review detail
            await this.reviewDetailRepository.save(reviewDetail);
            return reviewDetail;
        } catch (error) {
            logger.error(`Error saving review detail: ${error.message}`);
            throw error;
        }
    }

    public async updateReviewDetail(reviewId: number, updatedDetails: Partial<ReviewDetailEntity>, userId: string) {
        try {
            // Find existing review detail
            const reviewDetail = await this.reviewDetailRepository.findOne({ where: { reviewId } });
            if (!reviewDetail) {
                throw CustomErrorHandler.notFound(`Review detail not found for review ID ${reviewId}`);
            }

            // Update review details
            Object.assign(reviewDetail, updatedDetails);
            await this.reviewDetailRepository.save({
                ...reviewDetail,
                updatedBy: userId,
                updatedAt: new Date()
            });

            return reviewDetail;
        } catch (error) {
            logger.error(`Error updating review detail: ${error.message}`);
            throw error;
        }
    }

    public async getReviewDetail(reviewId: number) {
        try {
            // Fetch and return review detail
            const reviewDetail = await this.reviewDetailRepository.findOne({ where: { reviewId } });
            if (!reviewDetail) {
                throw CustomErrorHandler.notFound(`Review detail not found for review ID ${reviewId}`);
            }

            return reviewDetail;
        } catch (error) {
            throw error;
        }
    }
}

