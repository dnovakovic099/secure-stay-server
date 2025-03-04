import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import { ReservationInfoService } from "./ReservationInfoService";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReviewDetailOldLogs } from "../entity/ReviewDetailOldLogs";  // Add import for the OldLogs entity
import { Between } from "typeorm";
import { sendReviewUpdateEmail } from "./ReviewDetailEmailService";

export class ReviewDetailService {
    private reviewDetailRepository = appDatabase.getRepository(ReviewDetailEntity);
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private reviewDetailOldLogsRepository = appDatabase.getRepository(ReviewDetailOldLogs);  // Add repository for old logs

    // Save new review detail
    public async saveReviewDetail(reviewId: number, details: Partial<ReviewDetailEntity>, userId: string) {
        try {
            const review = await this.reviewRepository.findOne({ where: { id: reviewId } });
            if (!review) {
                throw CustomErrorHandler.notFound(`Review with ID ${reviewId} not found`);
            }

            const existingDetail = await this.reviewDetailRepository.findOne({ where: { reviewId } });
            if (existingDetail) {
                throw CustomErrorHandler.alreadyExists(`Review detail already exists for review ID ${reviewId}`);
            }

            const reservationInfoService = new ReservationInfoService();
            const reservation = await reservationInfoService.getReservationById(review.reservationId);

            const reviewDetail = this.reviewDetailRepository.create({
                ...details,
                guestEmail: reservation?.guestEmail || '',
                guestPhone: reservation?.phone || '',
                bookingAmount: reservation?.totalPrice,
                reviewId,
                review,
                createdBy: userId
            });

            await this.reviewDetailRepository.save(reviewDetail);
            return reviewDetail;
        } catch (error) {
            logger.error(`Error saving review detail: ${error.message}`);
            throw error;
        }
    }

    // Update review detail
    public async updateReviewDetail(reviewId: number, updatedDetails: Partial<ReviewDetailEntity>, userId: string) {
        try {
            const reviewDetail = await this.reviewDetailRepository.findOne({ where: { reviewId }, relations: ['oldLog'] });
            if (!reviewDetail) {
                throw CustomErrorHandler.notFound(`Review detail not found for review ID ${reviewId}`);
            }

            // Check if old logs exist
            if (reviewDetail.oldLog) {
                // Update existing old log
                Object.assign(reviewDetail.oldLog, reviewDetail);  // Copy current review detail into old log
                reviewDetail.oldLog.updatedAt = new Date();  // Set updated date for old log
                reviewDetail.oldLog.whoUpdated = reviewDetail.whoUpdated;  // Set the "who updated" field

                await this.reviewDetailOldLogsRepository.save(reviewDetail.oldLog)
            } else {
                // No old log exists, create a new one
                const oldLog = this.reviewDetailOldLogsRepository.create({
                    ...reviewDetail,
                    reviewDetailId: reviewDetail.id,
                    whoUpdated: reviewDetail.whoUpdated ?? 'N/A'
                });
                await this.reviewDetailOldLogsRepository.save(oldLog);
                reviewDetail.oldLog = oldLog;  // Link the old log to the review detail
            }

            // Update the review detail itself
            Object.assign(reviewDetail, updatedDetails);
            reviewDetail.updatedBy = userId;
            reviewDetail.updatedAt = new Date();



            await this.reviewDetailRepository.save(reviewDetail);

            // return reviewDetail without oldLog
            const reviewDetailWithoutOldLog = { ...reviewDetail, oldLog: undefined };
            return reviewDetailWithoutOldLog;
        } catch (error) {
            logger.error(`Error updating review detail: ${error.message}`);
            throw error;
        }
    }

    // Get review detail
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


    public async checkUpdatedReviews() {
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24); // Get 24 hours ago

        try {
            // Fetch reviews updated in the last 24 hours, only if they have old logs
            const updatedReviews = await this.reviewDetailRepository.find({
                where: {
                    updatedAt: Between(twentyFourHoursAgo, new Date()), // Filter by last 24 hours
                },
                relations: ['oldLog'], // Ensure we get the related old logs
            });

            // Filter out reviews that do not have old logs
            const reviewsWithOldLogs = updatedReviews.filter(review => review.oldLog);

            if (reviewsWithOldLogs.length === 0) {
                logger.info('No reviews with old logs updated in the last 24 hours.');
                return; // If no reviews have old logs, exit early
            }

            // Loop through each review with old logs and send email
            for (const review of reviewsWithOldLogs) {
                await sendReviewUpdateEmail(review); // Send the email with updated review details
            }
        } catch (error) {
            logger.error(`Error checking updated reviews: ${error.message}`);
            throw error;
        }
    }
}
