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
import { ExpenseService } from "./ExpenseService";
import { ResolutionService } from "./ResolutionService";
import { format } from "date-fns";

export class ReviewDetailService {
    private reviewDetailRepository = appDatabase.getRepository(ReviewDetailEntity);
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private reviewDetailOldLogsRepository = appDatabase.getRepository(ReviewDetailOldLogs);
    private removalAttemptRepository = appDatabase.getRepository(RemovalAttemptEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private expenseService = new ExpenseService();
    private resolutionService = new ResolutionService();

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

    private async createExpenseForResolution(reviewDetail: ReviewDetailEntity, userId: string) {
        const expenseObj = {
            body: {
                listingMapId: reviewDetail.review.listingMapId,
                expenseDate: format(new Date(), 'yyyy-MM-dd'),
                concept: `Resolution for review ${reviewDetail.reviewId}`,
                amount: reviewDetail.resolutionAmount,
                categories: JSON.stringify([12]), // Using category 12 as per existing code
                dateOfWork: null,
                contractorName: " ",
                contractorNumber: null,
                findings: `${reviewDetail.review.reviewerName} - <a href="https://securestay.ai/luxury-lodging/reviews?id=${reviewDetail.reviewId}" target="_blank" style="color: blue; text-decoration: underline;">Review Link</a>`,
                status: "Pending Approval",
                paymentMethod: null,
                createdBy: userId
            }
        };

        return await this.expenseService.createExpense(expenseObj, userId);
    }

    private async createResolutionForReview(reviewDetail: ReviewDetailEntity, userId: string) {
        const resolutionData = {
            category: "others",
            description: `Resolution for review ${reviewDetail.reviewId}`,
            listingMapId: reviewDetail.review.listingMapId,
            reservationId: reviewDetail.review.reservationId,
            guestName: reviewDetail.review.reviewerName,
            claimDate: format(new Date(), 'yyyy-MM-dd'),
            amount: reviewDetail.resolutionAmount,
            arrivalDate: reviewDetail.review.arrivalDate,
            departureDate: reviewDetail.review.departureDate
        };

        return await this.resolutionService.createResolution(resolutionData, userId);
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

            // Create expense and resolution if resolution amount is provided
            if (details.resolutionAmount) {
                const expense = await this.createExpenseForResolution(savedReviewDetail, userId);
                savedReviewDetail.expenseId = expense.id;
                await this.reviewDetailRepository.save(savedReviewDetail);

                await this.createResolutionForReview(savedReviewDetail, userId);
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
                relations: ['oldLog', 'removalAttempts', 'review'] 
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

            // Handle resolution amount changes
            if (updatedDetails.resolutionAmount && updatedDetails.resolutionAmount !== reviewDetail.oldLog.resolutionAmount) {
                // If there was a previous expense, delete it
                if (reviewDetail.expenseId) {
                    const expense = await this.expenseService.getExpense(reviewDetail.expenseId);
                    await this.expenseService.deleteExpense(expense.expenseId, userId);
                }

                // Create new expense and resolution
                const expense = await this.createExpenseForResolution(reviewDetail, userId);
                reviewDetail.expenseId = expense.id;
                await this.reviewDetailRepository.save(reviewDetail);

                await this.createResolutionForReview(reviewDetail, userId);
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
