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
import { ExpenseEntity } from "../entity/Expense";
import { Resolution } from "../entity/Resolution";
import { Issue } from "../entity/Issue";
import { RefundRequestService } from "./RefundRequestService";

export class ReviewDetailService {
    private reviewDetailRepository = appDatabase.getRepository(ReviewDetailEntity);
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private reviewDetailOldLogsRepository = appDatabase.getRepository(ReviewDetailOldLogs);
    private removalAttemptRepository = appDatabase.getRepository(RemovalAttemptEntity);
    private usersRepository = appDatabase.getRepository(UsersEntity);
    private resolutionRepository = appDatabase.getRepository(Resolution);
    private issueRepo = appDatabase.getRepository(Issue);
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
                concept: `Resolution for review removal (${reviewDetail.review.reviewerName})`,
                amount: reviewDetail.resolutionAmount,
                categories: JSON.stringify([23551]),
                dateOfWork: null,
                contractorName: " ",
                contractorNumber: null,
                findings: "",
                status: "Pending Approval",
                paymentMethod: null,
                createdBy: userId
            }
        };

        return await this.expenseService.createExpense(expenseObj, userId);
    }

    private async updateExpenseForResolution(expense: ExpenseEntity, amount: number, userId: string) {
        
        const expenseObj = {
            body: {
                expenseId: expense.expenseId,
                listingMapId: expense.listingMapId,
                expenseDate: expense.expenseDate,
                concept: expense.concept,
                amount: amount,
                categories: expense.categories,
                dateOfWork: expense.dateOfWork,
                contractorName: expense.contractorName,
                contractorNumber: expense.contractorNumber,
                findings: expense.findings,
                status: expense.status,
                paymentMethod: expense.paymentMethod,
            }
        };

        return await this.expenseService.updateExpense(expenseObj, userId);
    }

    private async createResolutionForReview(reviewDetail: ReviewDetailEntity, userId: string) {
        const resolutionData = {
            category: "review_removal",
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

    private async updateResolutionForReview(resolution: Resolution, amount: number, userId: string) {
        const resolutionData = {
            id: resolution.id,
            category: resolution.category,
            description: resolution.description,
            listingMapId: resolution.listingMapId,
            reservationId: resolution.reservationId,
            guestName: resolution.guestName,
            claimDate: new Date(resolution.claimDate),
            amount: amount,
            updatedBy: userId,
            arrivalDate: resolution.arrivalDate,
            departureDate: resolution.departureDate,
        };

        return await this.resolutionService.updateResolution(resolutionData, userId);
    }

    private async createRefundRequestForRemovalAttempt(attempt: RemovalAttemptEntity, review: ReviewEntity, userId: string) {
        //find the issueId and requestedBy
        const issueIds = await this.issueRepo.find({
            where: {
                reservation_id: String(review.reservationId),
            }
        }).then(issues => issues.map(issue => issue.id));

        const requestedBy = await this.getUserName(userId);

        const refundRequest = {
            reservationId: review.reservationId,
            listingId: review.listingMapId,
            guestName: review.guestName,
            listingName: review.listingName,
            checkIn: review.arrivalDate,
            checkOut: review.departureDate,
            issueId: JSON.stringify(issueIds),
            explaination: attempt.details,
            refundAmount: attempt.resolutionAmount || 0,
            requestedBy: requestedBy,
            status: 'Pending',
            notes: '',
            attachments: null,
            createdBy: userId
        };

        const refundRequestService = new RefundRequestService();
        const refundRequst= await refundRequestService.saveRefundRequest(refundRequest, userId, []);
        if (!refundRequst) {
            logger.info('Error creating refund request');
            return null;
        }
        return refundRequst.id;
    }

    private async updateRefundRequestForRemovalAttempt(attempt: RemovalAttemptEntity, userId: string) {
        //find the issueId and requestedBy
        const issueIds = await this.issueRepo.find({
            where: {
                reservation_id: String(attempt.reviewDetail.review.reservationId),
            }
        }).then(issues => issues.map(issue => issue.id));

        const requestedBy = await this.getUserName(userId);

        const refundRequest = {
            reservationId: attempt.reviewDetail.review.reservationId,
            listingId: attempt.reviewDetail.review.listingMapId,
            guestName: attempt.reviewDetail.review.guestName,
            listingName: attempt.reviewDetail.review.listingName,
            checkIn: attempt.reviewDetail.review.arrivalDate,
            checkOut: attempt.reviewDetail.review.departureDate,
            issueId: JSON.stringify(issueIds),
            explaination: attempt.details,
            refundAmount: attempt.resolutionAmount || 0,
        };

        const refundRequestService = new RefundRequestService();
        const existingRefundRequest = await refundRequestService.getRefundRequestById(attempt.refundRequestId);
        const refundRequst = await refundRequestService.saveRefundRequest(refundRequest, userId, [], existingRefundRequest);
        if (!refundRequst) {
            logger.info('Error updating refund request');
            return null;
        }
        return refundRequst.id;
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
                bookingAmount: Number(reservation?.totalPrice),
                reviewId,
                review,
                createdBy: userId,
                whoUpdated: userName
            });

            const savedReviewDetail = await this.reviewDetailRepository.save(reviewDetail);

            // Save removal attempts if any
            if (details.removalAttempts && details.removalAttempts.length > 0) {
                const removalAttempts = details.removalAttempts.map(async (attempt) => {
                    const refundRequestId = attempt.resolutionAmount && await this.createRefundRequestForRemovalAttempt(attempt, review, userId);
                    return this.removalAttemptRepository.create({
                        ...attempt,
                        reviewDetailId: savedReviewDetail.id,
                        refundRequestId: refundRequestId,
                        createdBy: userId
                    });
                });

                // Resolve all promises to get the removal attempts
                const resolvedRemovalAttempts = await Promise.all(removalAttempts);

                await this.removalAttemptRepository.save(resolvedRemovalAttempts);
            }

            // Create expense and resolution if resolution amount is provided
            // if (details.resolutionAmount) {
            //     const expense = await this.createExpenseForResolution(savedReviewDetail, userId);
            //     const resolution = await this.createResolutionForReview(savedReviewDetail, userId);
            //     savedReviewDetail.expenseId = expense.id;  
            //     savedReviewDetail.resolutionId = resolution.id;
            //     await this.reviewDetailRepository.save(savedReviewDetail);
            // }

            return this.getReviewDetailWithAttempts(savedReviewDetail.id);
        } catch (error) {
            logger.error(`Error saving review detail: ${error.message}`);
            throw error;
        }
    }

    private async handleUpdateCaseForExistingAtempt(attempt: RemovalAttemptEntity, reviewDetailId: number, review: ReviewEntity, userId: string) {
        const existingAttempt = await this.removalAttemptRepository.findOne({ where: { id: attempt.id } });
        if (existingAttempt.resolutionAmount) {
            //CASE 1: if resolution amount was present previously and now updated with some other value
            if (attempt.resolutionAmount !== existingAttempt.resolutionAmount) {
                const refundRequestId = await this.updateRefundRequestForRemovalAttempt(attempt, userId);
                Object.assign(existingAttempt, {
                    ...attempt,
                    reviewDetailId: reviewDetailId,
                    refundRequestId: refundRequestId,
                    updatedBy: userId,
                    updatedAt: new Date()
                });
            } else if (!attempt.resolutionAmount) {
                //CASE 2: if resolution amount was present previously and now removed
                //delete the existing refund request and update the refundRequestId to null in attempt
                const refundRequestId = existingAttempt.refundRequestId;
                if (refundRequestId) {
                    const refundRequestService = new RefundRequestService();
                    await refundRequestService.deleteRefundRequest(refundRequestId, userId);
                }
                Object.assign(existingAttempt, {
                    ...attempt,
                    reviewDetailId: reviewDetailId,
                    refundRequestId: null,
                    updatedBy: userId,
                    updatedAt: new Date()
                });
            } else {
                //CASE 4: if resolution amount was present previously and now updated with the same value
                Object.assign(existingAttempt, {
                    ...attempt,
                    reviewDetailId: reviewDetailId,
                    updatedBy: userId,
                    updatedAt: new Date()
                });
            }

            return this.removalAttemptRepository.save(existingAttempt);
        } else {
            //CASE 3: if resolution amount was not present previously and now added
            const refundRequestId = attempt.resolutionAmount && await this.createRefundRequestForRemovalAttempt(attempt, review, userId);
            Object.assign(existingAttempt, {
                ...attempt,
                reviewDetailId: reviewDetailId,
                refundRequestId: refundRequestId,
                createdBy: userId,
                createdAt: new Date()
            });
            return this.removalAttemptRepository.save(existingAttempt);
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
                const removalAttempts = updatedDetails.removalAttempts.map(async (attempt) => {
                    if (attempt.id) {
                        return await this.handleUpdateCaseForExistingAtempt(attempt, reviewDetail.id, reviewDetail.review, userId);
                    } else {
                        const refundRequestId = attempt.resolutionAmount && await this.createRefundRequestForRemovalAttempt(attempt, reviewDetail.review, userId);
                        const newAttempt = this.removalAttemptRepository.create({
                            ...attempt,
                            reviewDetailId: reviewDetail.id,
                            refundRequestId: refundRequestId,
                            createdBy: userId
                        });
                        return await this.removalAttemptRepository.save(newAttempt);
                    }
                });

                // Resolve all promises to get the removal attempts
                await Promise.all(removalAttempts);
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
