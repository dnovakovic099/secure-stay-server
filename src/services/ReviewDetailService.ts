import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReviewDetailEntity } from "../entity/ReviewDetail";
import { ReservationInfoService } from "./ReservationInfoService";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReviewDetailOldLogs } from "../entity/ReviewDetailOldLogs";
import { RemovalAttemptEntity } from "../entity/RemovalAttempt";
import { Between } from "typeorm";
import { sendReviewUpdateEmail } from "./ReviewDetailEmailService";
import { UsersEntity } from "../entity/Users";

export class ReviewDetailService {
    private reviewDetailRepository = appDatabase.getRepository(ReviewDetailEntity);
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private reviewDetailOldLogsRepository = appDatabase.getRepository(ReviewDetailOldLogs);
    private removalAttemptRepository = appDatabase.getRepository(RemovalAttemptEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);

    private async getUserName(userId: string): Promise<string> {
        try {
            const user = await this.usersRepository.findOne({
                where: {
                    uid: userId
                }
            });
            if (user?.firstName) {
                return user.firstName + ' ' + user.lastName;
            }
            return user.email;
        } catch (error) {
            logger.error(`Error getting user name: ${error.message}`);
            return userId;
        }
    }

    public async saveReviewDetail(reviewId: string, details: Partial<ReviewDetailEntity>, userId: string) {
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
            const userName = await this.getUserName(userId);

            const reviewDetail = this.reviewDetailRepository.create({
                ...details,
                guestEmail: reservation?.guestEmail || '',
                guestPhone: reservation?.phone || '',
                bookingAmount: reservation?.totalPrice,
                reviewId,
                review,
                createdBy: userId,
                whoUpdated: userName
            });

            const savedReviewDetail = await this.reviewDetailRepository.save(reviewDetail);

            // Save removal attempts if any
            if (details.removalAttempts && details.removalAttempts.length > 0) {
                const removalAttempts = details.removalAttempts.map(attempt => 
                    this.removalAttemptRepository.create({
                        ...attempt,
                        reviewDetailId: savedReviewDetail.id,
                        createdBy: userId
                    })
                );
                await this.removalAttemptRepository.save(removalAttempts);
            }

            return this.getReviewDetailWithAttempts(savedReviewDetail.id);
        } catch (error) {
            logger.error(`Error saving review detail: ${error.message}`);
            throw error;
        }
    }

    public async updateReviewDetail(reviewId: string, updatedDetails: Partial<ReviewDetailEntity>, userId: string) {
        try {
            const reviewDetail = await this.reviewDetailRepository.findOne({ 
                where: { reviewId }, 
                relations: ['oldLog', 'removalAttempts'] 
            });
            
            if (!reviewDetail) {
                throw CustomErrorHandler.notFound(`Review detail not found for review ID ${reviewId}`);
            }

            // Check if old logs exist
            if (reviewDetail.oldLog) {
                Object.assign(reviewDetail.oldLog, reviewDetail);
                reviewDetail.oldLog.updatedAt = new Date();
                reviewDetail.oldLog.whoUpdated = reviewDetail.whoUpdated;
                await this.reviewDetailOldLogsRepository.save(reviewDetail.oldLog);
            } else {
                const oldLog = this.reviewDetailOldLogsRepository.create({
                    ...reviewDetail,
                    reviewDetailId: reviewDetail.id,
                    whoUpdated: reviewDetail.whoUpdated ?? 'N/A'
                });
                await this.reviewDetailOldLogsRepository.save(oldLog);
                reviewDetail.oldLog = oldLog;
            }

            const userName = await this.getUserName(userId);

            // Update the review detail itself
            Object.assign(reviewDetail, {
                ...updatedDetails,
                whoUpdated: userName,
                updatedBy: userId,
                updatedAt: new Date()
            });

            await this.reviewDetailRepository.save(reviewDetail);

            // Update removal attempts
            if (updatedDetails.removalAttempts) {
                // Delete existing attempts
                await this.removalAttemptRepository.delete({ reviewDetailId: reviewDetail.id });
                
                // Create new attempts
                const removalAttempts = updatedDetails.removalAttempts.map(attempt => 
                    this.removalAttemptRepository.create({
                        ...attempt,
                        reviewDetailId: reviewDetail.id,
                        createdBy: userId
                    })
                );
                await this.removalAttemptRepository.save(removalAttempts);
            }

            return this.getReviewDetailWithAttempts(reviewDetail.id);
        } catch (error) {
            logger.error(`Error updating review detail: ${error.message}`);
            throw error;
        }
    }

    public async getReviewDetail(reviewId: string) {
        try {
            const reviewDetail = await this.reviewDetailRepository.findOne({ 
                where: { reviewId },
                relations: ['removalAttempts']
            });
            
            if (!reviewDetail) {
                throw CustomErrorHandler.notFound(`Review detail not found for review ID ${reviewId}`);
            }

            return reviewDetail;
        } catch (error) {
            throw error;
        }
    }

    private async getReviewDetailWithAttempts(reviewDetailId: number) {
        const reviewDetail = await this.reviewDetailRepository.findOne({
            where: { id: reviewDetailId },
            relations: ['removalAttempts']
        });
        return reviewDetail;
    }

    public async checkUpdatedReviews() {
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        try {
            const updatedReviews = await this.reviewDetailRepository.find({
                where: {
                    updatedAt: Between(twentyFourHoursAgo, new Date()),
                },
                relations: ['oldLog', 'review', 'removalAttempts'],
            });

            const reviewsWithOldLogs = updatedReviews.filter(review => review.oldLog);

            if (reviewsWithOldLogs.length === 0) {
                logger.info('No reviews with old logs updated in the last 24 hours.');
                return;
            }

            for (const review of reviewsWithOldLogs) {
                await sendReviewUpdateEmail(review);
            }
        } catch (error) {
            logger.error(`Error checking updated reviews: ${error.message}`);
        }
    }
}
