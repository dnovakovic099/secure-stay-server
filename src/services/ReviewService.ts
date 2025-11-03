import { Between, In, IsNull, ILike, LessThan, LessThanOrEqual, Not, MoreThanOrEqual } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReservationService } from "./ReservationService";
import { OwnerInfoEntity } from "../entity/OwnerInfo";
import sendEmail from "../utils/sendEmai";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ReservationInfoService } from "./ReservationInfoService";
import { v4 as uuidv4 } from 'uuid';
import axios from "axios";
import { Claim } from "../entity/Claim";
import { buildClaimReviewReceivedMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { ListingService } from "./ListingService";
import { addDays, endOfDay, format, getDay, startOfDay } from "date-fns";
import { ActionItemsService } from "./ActionItemsService";
import { IssuesService } from "./IssuesService";
import { UsersEntity } from "../entity/Users";
import { ReviewCheckout } from "../entity/ReviewCheckout";
import { ReviewCheckoutUpdates } from "../entity/ReviewCheckoutUpdates";
import { BadReviewEntity } from "../entity/BadReview";
import { BadReviewUpdatesEntity } from "../entity/BadReviewUpdates";

interface ProcessedReview extends ReviewEntity {
    unresolvedForMoreThanThreeDays: boolean;
    unresolvedForMoreThanSevenDays: boolean;
}

interface CreateReview {
    reservationId: number;
    reviewerName: string;
    rating: number;
    publicReview: string;
    status: string;
}

interface Filter {
    listingMapId?: string[];
    guestName?: string;
    page?: number;
    limit?: number;
    userId?: string;
    actionItemsStatus?: string[] | null | undefined;
    issuesStatus?: string[] | null | undefined;
    channel?: string[] | null | undefined;
    payment?: string[] | null | undefined;
    keyword?: string | undefined;
    todayDate?: string | undefined;
    status?: string[] | null | undefined;
    isActive?: boolean | null | undefined;
    tab?: string | null | undefined;
}


interface FilterBadReviews {
    listingMapId?: string[];
    guestName?: string;
    page?: number;
    limit?: number;
    userId?: string;
    actionItemsStatus?: string[] | null | undefined;
    issuesStatus?: string[] | null | undefined;
    channel?: string[] | null | undefined;
    payment?: string[] | null | undefined;
    keyword?: string | undefined;
    todayDate?: string | undefined;
    status?: string[] | null | undefined;
    isActive?: boolean | null | undefined;
    tab?: string | null | undefined;
}

export enum ReviewCheckoutStatus {
    TO_CALL = "To Call",
    FOLLOW_UP_NO_ANSWER = "Follow up (No answer)",
    FOLLOW_UP_REVIEW_CHECK = "Follow up (Review check)",
    NO_FURTHER_ACTION_REQUIRED = "No further action required",
    ISSUE = "Issue",
    CLOSED_FIVE_STAR = "Closed - 5 Star",
    CLOSED_BAD_REVIEW = "Closed - Bad Review",
    CLOSED_NO_REVIEW = "Closed - No Review",
    CLOSED_TRAPPED = "Closed - Trapped",
    LAUNCH = "Launch"
}


export enum BadReviewStatus {
    NEW = 'New',
    CALL_PHASE = 'Call Phase',
    PENDING_REMOVAL = 'Pending Removal',
    CLOSED_NO_ACTION_REQUIRED = 'Closed - No Action Required',
    CLOSED_REMOVED = 'Closed - Removed',
    CLOSED_FAILED = 'Closed - Failed'
}



export class ReviewService {
    private hostawayClient = new HostAwayClient();
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private ownerInfoRepository = appDatabase.getRepository(OwnerInfoEntity);
    private claimRepo = appDatabase.getRepository(Claim);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private reviewCheckoutRepo = appDatabase.getRepository(ReviewCheckout);
    private reviewCheckoutUpdatesRepo = appDatabase.getRepository(ReviewCheckoutUpdates);
    private badReviewRepo = appDatabase.getRepository(BadReviewEntity);
    private badReviewUpdatesRepo = appDatabase.getRepository(BadReviewUpdatesEntity);

    public async getReviews({
        fromDate,
        toDate,
        listingId,
        page,
        limit,
        rating,
        owner,
        claimResolutionStatus,
        status,
        isClaimOnly,
        keyword,
        propertyType,
        dateType,
        channel
    }) {
        try {
            let listingIds: number[] = [];

            // Determine listing IDs from owner name(s) if provided
            if ((!listingId || listingId.length === 0) && owner) {
                const ownerNames = Array.isArray(owner) ? owner : [owner];
                const results = await Promise.all(ownerNames.map(o => this.getListingIdsByOwnerName(o)));
                listingIds = results.flat();
            }

            if (propertyType && propertyType.length > 0) {
                const listingService = new ListingService();
                listingIds = listingIds.concat((await listingService.getListingsByTagIds(propertyType as any)).map(l => l.id));
            }
            
            // Add listingId(s) if provided
            if (listingId && listingId.length > 0) {
                const ids = Array.isArray(listingId) ? listingId : [listingId];
                listingIds = listingIds.concat(ids);
            }

            const condition: Record<string, any> = {
                ...(listingIds.length > 0 ? { listingMapId: In(listingIds) } : {}),
                ...(rating !== undefined ? { rating: LessThanOrEqual(rating) } : { rating: Not(IsNull()) }),
                ...(keyword && { publicReview: ILike(`%${keyword}%`) }),
                ...(channel && channel.length > 0 ? { channelId: In(channel) } : {}),
            };

            const allowedDateTypes = ["submittedAt", "arrivalDate", "departureDate"];

            if (fromDate !== undefined && toDate !== undefined && dateType && allowedDateTypes.includes(dateType)) {
                condition[dateType] = Between(fromDate, toDate);
            }

            const reviewDetailCondition: Record<string, any> = {};
            if (claimResolutionStatus !== undefined) {
                reviewDetailCondition.claimResolutionStatus = claimResolutionStatus;
            }

            if (status === "active") {
                condition.isHidden = 0;
            } else if (status === "hidden") {
                condition.isHidden = 1;
            }

            if (isClaimOnly && claimResolutionStatus === undefined) {
                reviewDetailCondition.claimResolutionStatus = Not("N/A");
            }

            const order: Record<string, 'ASC' | 'DESC'> = {};

            if (Object.keys(order).length === 0) {
                order.rating = 'ASC';
                const dateColumn = (dateType && allowedDateTypes.includes(dateType)) ? dateType : "submittedAt";
                order[dateColumn] = 'DESC';
            }

            const [reviews, totalCount] = await this.reviewRepository.findAndCount({
                where: {
                    ...condition,
                    reviewDetail: reviewDetailCondition,
                },
                relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
                skip: (page - 1) * limit,
                take: limit,
                order
            });

            const reviewList = [];

            for (const review of reviews) {
                const reservationInfoService = new ReservationInfoService();
                const reservationInfo = await reservationInfoService.getReservationById(review.reservationId);

                if (!reservationInfo) {
                    logger.warn(`Reservation not found for review with ID: ${review.id}`);
                }

                const reviewPlain = {
                    ...review,
                    guestPhone: reservationInfo?.phone || null,
                    bookingAmount: reservationInfo?.totalPrice || null,
                    guestEmail: reservationInfo?.guestEmail || null,
                };
                reviewList.push(reviewPlain);
            }

            return { reviewList, totalCount };
        } catch (error) {
            logger.error(`Failed to get reviews`, error);
            throw error;
        }
    }


    private async getListingIdsByOwnerName(ownerName: string) {
        const listingIds = await this.ownerInfoRepository
            .createQueryBuilder("owner")
            .select("owner.listingId", "listingId") // Select only listingId
            .where("owner.ownerName = :ownerName", { ownerName })
            .andWhere("owner.ownerName IS NOT NULL AND owner.ownerName != ''") // Ensure ownerName is valid
            .getRawMany();

        return listingIds.map(item => item.listingId); // Extract listingId values as an array
    }


    public async updateReviewVisibility(reviewVisibility: string, id: string, userId: string) {
        const review = await this.reviewRepository.findOne({ where: { id } });
        if (!review) {
            throw CustomErrorHandler.notFound(`Review not found with id: ${id}`);
        }

        review.isHidden = reviewVisibility == "Visible" ? 0 : 1;
        review.updatedAt = new Date();
        review.updatedBy = userId;
        await this.reviewRepository.save(review);

        return review;
    }


    // fetch all reviews from the hostaway and save it in the database
    public async syncReviews() {

        try {
            const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID;
            const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET;

            const reviews = await this.hostawayClient.getAllReviews(
                CLIENT_ID,
                CLIENT_SECRET
            );

            // Check if reviews were fetched successfully
            if (!reviews || reviews.length === 0) {
                logger.info("No reviews fetched from HostAway.");
                return;
            }

            const reservationService = new ReservationService();
            const channelList = await reservationService.getChannelList();

            // save the reviews in the database
            for (const reviewData of reviews) {
                // Check if the review already exists in the database
                const existingReview = await this.reviewRepository.findOne({
                    where: { id: reviewData.id },
                });

                if (existingReview) {
                    // Update the existing review
                    await this.reviewRepository.update(existingReview.id, {
                        reviewerName: reviewData.reviewerName,
                        channelId: reviewData.channelId,
                        rating: reviewData.rating,
                        externalReservationId: reviewData.externalReservationId,
                        publicReview: reviewData.publicReview,
                        submittedAt: reviewData.submittedAt,
                        arrivalDate: reviewData.arrivalDate,
                        departureDate: reviewData.departureDate,
                        listingName: reviewData.listingName,
                        externalListingName: reviewData.externalListingName,
                        guestName: reviewData.guestName,
                        listingMapId: reviewData.listingMapId,
                        channelName: channelList.find(channel => channel.channelId == reviewData.channelId).channelName,
                        // isHidden: reviewData?.isHidden || 0,
                        isHidden: existingReview.updatedBy ? existingReview.isHidden : reviewData?.isHidden || 0,
                        reservationId: reviewData?.reservationId || null
                    });

                    if (existingReview.rating != 10 && reviewData.rating == 10) {
                        await this.process5StarRatings(reviewData);
                    }

                } else {
                    // Create a new review entity and save it
                    const newReview = this.reviewRepository.create({
                        id: reviewData.id,
                        reviewerName: reviewData.reviewerName,
                        channelId: reviewData.channelId,
                        rating: reviewData.rating,
                        externalReservationId: reviewData.externalReservationId,
                        publicReview: reviewData.publicReview,
                        submittedAt: reviewData.submittedAt,
                        arrivalDate: reviewData.arrivalDate,
                        departureDate: reviewData.departureDate,
                        listingName: reviewData.listingName,
                        externalListingName: reviewData.externalListingName,
                        guestName: reviewData.guestName,
                        listingMapId: reviewData.listingMapId,
                        channelName: channelList.find(channel => channel.channelId == reviewData.channelId).channelName,
                        isHidden: reviewData?.isHidden || 0,
                        reservationId: reviewData?.reservationId || null,
                    });
                    await this.reviewRepository.save(newReview);

                    //check if there is active claim of the reviewer
                    await this.checkForActiveClaim(newReview);

                    if (reviewData.rating == 10) {
                        await this.process5StarRatings(reviewData);
                    }
                }
            }
        } catch (error) {
            logger.error("Error syncing reviews:", error);
            throw error;
        }
    }

    async checkForActiveClaim(review: ReviewEntity) {
        const claim = await this.claimRepo.findOne({
            where: {
                reservation_id: String(review.reservationId),
                status: "In Progress"
            }
        });
        if (!claim) return;
        const slackMessage = buildClaimReviewReceivedMessage(claim, review);
        await sendSlackMessage(slackMessage);
    }

    async checkForUnresolvedReviews() {
        const reviews = await this.reviewRepository.find({
            where: {
                isHidden: 0
            },
            order: {
                rating: 'ASC',
                submittedAt: 'DESC',
            },
        });
        const processedReviews = this.processUnresolvedReviews(reviews);
        const unresolvedReviewsFor3PlusDays = processedReviews.filter(review => review.unresolvedForMoreThanThreeDays);
        if (unresolvedReviewsFor3PlusDays.length > 0) {
            //send email
            await this.sendEmailForUnresolvedReviews(unresolvedReviewsFor3PlusDays);
        }
    }

    processUnresolvedReviews(reviews: ReviewEntity[]): ProcessedReview[] {
        return reviews
            .filter(review => review.submittedAt) // Exclude reviews without submittedAt
            .map(review => {
                const submittedDate = new Date(review.submittedAt);
                const currentDate = new Date();
                const diffInDays = Math.floor((currentDate.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24));

                return {
                    ...review,
                    unresolvedForMoreThanThreeDays: diffInDays > 3 && review.rating < 10,
                    unresolvedForMoreThanSevenDays: diffInDays > 7 && review.rating < 10,
                };
            });
    };

    private async sendEmailForUnresolvedReviews(reviews: ProcessedReview[]) {

        const subject = `Reminder: You Have ${reviews.length} Unresolved Reviews Awaiting Action`;
        const html = `
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333; margin: 0;">
    <div style="width: 100%; background: #fff; padding: 30px; border-bottom: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 22px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: Unresolved Guest Reviews
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        The following guest reviews require your attention. Please review them and take necessary action.
      </p>

      <!-- Scrollable Table Wrapper (Full Width) -->
      <div style="overflow-x: auto; width: 100%;">
        <table style="min-width: 1000px; border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Guest Name</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Arrival Date</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Departure Date</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Rating</th>
              <th style="background: #0056b3; color: #fff; padding: 12px; text-align: left; white-space: nowrap;">Public Review</th>
            </tr>
          </thead>
          <tbody>
            ${reviews.map(review => `
              <tr>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.guestName}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.arrivalDate}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; white-space: nowrap;">${review.departureDate}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd; font-weight: bold; color: ${review.rating < 5 ? 'red' : 'green'}; white-space: nowrap;">${review.rating}</td>
                <td style="padding: 12px; border-bottom: 1px solid #ddd;">${review.publicReview}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        Please take action on these unresolved reviews as soon as possible.
      </p>
    </div>
  </body>
</html>
        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, "admin@luxurylodgingpm.com");
    }

    public async saveReview(body: CreateReview, userId: string) {
        const { reservationId, reviewerName, rating, publicReview, status } = body;

        const reservationInfoService = new ReservationInfoService();
        const reservationInfo = await reservationInfoService.getReservationById(reservationId);
        if (!reservationInfo) {
            throw CustomErrorHandler.notFound('Reservation not found');
        }

        const reviewObj = {
            id: uuidv4(),
            reviewerName,
            listingMapId: reservationInfo.listingMapId,
            channelId: reservationInfo.channelId,
            channelName: reservationInfo.channelName,
            rating,
            publicReview,
            arrivalDate: String(reservationInfo.arrivalDate),
            departureDate: String(reservationInfo.departureDate),
            listingName: reservationInfo.listingName,
            guestName: reservationInfo.guestName,
            isHidden: status == "active" ? 0 : 1,
            bookingAmount: reservationInfo.totalPrice,
            reservationId,
            createdBy: userId
        };
        return await this.createReview(reviewObj);
    }

    private async createReview(obj: any) {
        const newReview = this.reviewRepository.create(obj);
        return await this.reviewRepository.save(newReview);
    }

    private async process5StarRatings(review) {
        const reviewerName = review.reviewerName;
        const listingMapId = review.listingMapId;
        const rating = 5.0;
        const reviewId = review.id;

        try {
            const url = `${process.env.OWNER_PORTAL_API_BASE_URL}/new-review`;
            const body = {
                reviewerName,
                listingMapId,
                rating,
                reviewId
            };
            const response = await axios.post(url, body, {
                headers: {
                    "x-internal-source": "securestay.ai"
                }
            });

            if (response.status !== 200) {
                logger.error(`[process5StarRatings] Response status: ${response.status}`);
                logger.error(`[process5StarRatings] Failed to send notification to mobile user for new review by ${reviewerName}`);
            }

            logger.info(`[process5StarRatings] Processed notification to mobile user for new review by ${reviewerName}`);
            return response.data;
        } catch (error) {
            logger.error(error);
            logger.error('[process5StarRatings] Failed to send notification to mobile user for new review');
            return null;
        }

    }

    /**
     * Get reviews for checkout with tab-based filtering
     * 
     * API Usage Examples:
     * 
     * 1. TODAY TAB:
     *    - Shows 'To Call' status + follow up statuses with sevenDaysAfterCheckout < todayDate
     *    - Parameters: { tab: 'today', todayDate: '2024-01-15', page: 1, limit: 10 }
     * 
     * 2. ACTIVE TAB:
     *    - Shows follow up statuses + Issue + No Further Action statuses
     *    - Special logic: If sevenDaysAfterCheckout <= todayDate for follow up statuses, 
     *      only shows if isActive = true
     *    - Parameters: { tab: 'active', todayDate: '2024-01-15', page: 1, limit: 10 }
     * 
     * 3. CLOSED TAB:
     *    - Shows all closed statuses (Closed - 5 Star, Closed - Bad Review, etc.)
     *    - Parameters: { tab: 'closed', page: 1, limit: 10 }
     * 
     * Additional filters work with all tabs:
     * - listingMapId: Filter by specific listing IDs
     * - guestName: Filter by guest name (partial match)
     * - channel: Filter by channel IDs
     * - actionItemsStatus: Filter action items by status
     * - issuesStatus: Filter issues by status
     */
    async getReviewsForCheckout(filters: Filter, userId: string) {
        const {
            page, limit, listingMapId, guestName,
            actionItemsStatus, issuesStatus, channel,
            todayDate, status, isActive, tab,
        } = filters;

        //fetch reviewCheckoutList
        const query = this.reviewCheckoutRepo
            .createQueryBuilder("reviewCheckout")
            .leftJoinAndSelect("reviewCheckout.reservationInfo", "reservationInfo")
            .leftJoinAndSelect("reviewCheckout.reviewCheckoutUpdates", "reviewCheckoutUpdates");

        // Tab-based filtering logic
        if (tab) {
            switch (tab.toLowerCase()) {
                case 'today':
                    // Today tab: Show 'To Call' status + follow up statuses with sevenDaysAfterCheckout < todayDate
                    query.andWhere(`
                        (reviewCheckout.status = :toCallStatus) OR 
                        (reviewCheckout.status IN (:followUpStatuses) AND reviewCheckout.sevenDaysAfterCheckout <= :todayDate)
                    `, {
                        toCallStatus: ReviewCheckoutStatus.TO_CALL,
                        followUpStatuses: [ReviewCheckoutStatus.FOLLOW_UP_NO_ANSWER, ReviewCheckoutStatus.FOLLOW_UP_REVIEW_CHECK],
                        todayDate: todayDate || format(new Date(), 'yyyy-MM-dd')
                    });
                    break;

                case 'active':
                    // Active tab: Show follow up statuses + Issue + No Further Action
                    // Special condition: If sevenDaysAfterCheckout <= todayDate for follow up statuses, 
                    // only show if isActive is true
                    query.andWhere(`
                        (reviewCheckout.status IN (:followUpStatuses) AND reviewCheckout.sevenDaysAfterCheckout > :todayDate) OR
                        (reviewCheckout.status IN (:followUpStatuses) AND reviewCheckout.sevenDaysAfterCheckout <= :todayDate AND reviewCheckout.isActive = true) OR
                        (reviewCheckout.status IN (:activeStatuses))
                    `, {
                        followUpStatuses: [ReviewCheckoutStatus.FOLLOW_UP_NO_ANSWER, ReviewCheckoutStatus.FOLLOW_UP_REVIEW_CHECK],
                        activeStatuses: [ReviewCheckoutStatus.ISSUE, ReviewCheckoutStatus.NO_FURTHER_ACTION_REQUIRED, ReviewCheckoutStatus.LAUNCH],
                        todayDate: todayDate || format(new Date(), 'yyyy-MM-dd')
                    });
                    break;

                case 'closed':
                    // Closed tab: Show all closed statuses
                    query.andWhere("reviewCheckout.status IN (:...closedStatuses)", {
                        closedStatuses: [
                            ReviewCheckoutStatus.CLOSED_FIVE_STAR,
                            ReviewCheckoutStatus.CLOSED_BAD_REVIEW,
                            ReviewCheckoutStatus.CLOSED_NO_REVIEW,
                            ReviewCheckoutStatus.CLOSED_TRAPPED,
                        ]
                    });
                    break;

                default:
                    // If tab is provided but not recognized, use existing status filter logic
                    if (status && status.length > 0) {
                        query.andWhere("reviewCheckout.status IN (:...status)", { status });
                    }
                    break;
            }
        } else {
            // Legacy status filter (when no tab is specified)
            if (status && status.length > 0) {
                query.andWhere("reviewCheckout.status IN (:...status)", { status });
            }
        }

        // Listing filter
        if (listingMapId && listingMapId.length > 0) {
            query.andWhere("reservationInfo.listingMapId IN (:...listingMapId)", { listingMapId: listingMapId.map(id => Number(id)) });
        }

        // Guest name filter
        if (guestName) {
            query.andWhere("reservationInfo.guestName ILIKE :guestName", { guestName: `${guestName}%` });
        }

        // Channel filter
        if (channel && channel.length > 0) {
            query.andWhere("reservationInfo.channelId IN (:...channel)", { channel: channel.map(id => Number(id)) });
        }

        query.skip((page - 1) * limit).take(limit);
        query.orderBy("reviewCheckout.createdAt", "DESC");

        const [reviewCheckoutList, total] = await query.getManyAndCount();

        const reservationIds = reviewCheckoutList.map(rc => rc.reservationInfo.id);

        // append reviews for each reservations
        const reviews = await this.reviewRepository.find({
            where: {
                reservationId: In(reservationIds),
                isHidden: 0,
            },
            relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
            order: {
                createdAt: 'DESC',
            },
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

        const issueServices = new IssuesService();
        const actionItemServices = new ActionItemsService();

        const issues = (await issueServices.getGuestIssues({ page: 1, limit: 500, reservationId: reservationIds, status: issuesStatus }, userId)).issues;
        const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 500, reservationId: reservationIds, status: actionItemsStatus })).actionItems;

        const transformedData = reviewCheckoutList.map(rc => {
            return {
                ...rc,
                assignee: userMap.get(rc.assignee) || rc.assignee,
                createdBy: userMap.get(rc.createdBy) || rc.createdBy,
                updatedBy: userMap.get(rc.updatedBy) || rc.updatedBy,
                deletedBy: userMap.get(rc.deletedBy) || rc.deletedBy,
                reservationInfo: {
                    ...rc.reservationInfo,
                    review: reviews.find(r => r.reservationId == rc.reservationInfo?.id) || null,
                    issues: issues.filter(issue => Number(issue.reservation_id) == rc.reservationInfo?.id) || null,
                    actionItems: actionItems.filter(item => item.reservationId == rc.reservationInfo?.id) || null,
                },
                reviewCheckoutUpdates: rc.reviewCheckoutUpdates.map(update => {
                    return {
                        ...update,
                        createdBy: userMap.get(update.createdBy) || update.createdBy,
                        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                    };
                }),
                reviews: reviews.filter(r => r.reservationId == rc.reservationInfo?.id) || [],
            };
        });

        return { result: transformedData, total };
    }


    getAdjustedDepartureDate(departureDate: Date): string {
        const dayOfWeek = getDay(departureDate); // Sunday = 0, Monday = 1, ..., Saturday = 6
        let adjustedDate = departureDate;

        if (dayOfWeek === 6) {
            // Saturday → move to Monday
            adjustedDate = addDays(departureDate, 2);
        } else if (dayOfWeek === 0) {
            // Sunday → move to Monday
            adjustedDate = addDays(departureDate, 1);
        }

        return format(adjustedDate, "yyyy-MM-dd");
    }

    async processReviewCheckout() {
        // ---------------------------------------------------------------------------------------------------------------------
        // Step 1: Update existing review checkouts whose status is not closed and if review is placed or 14 days after checkout is passed
        const today = format(new Date(), 'yyyy-MM-dd');
        const existingReviewCheckouts = await this.reviewCheckoutRepo.find({
            where: {
                status: Not(In([ReviewCheckoutStatus.CLOSED_BAD_REVIEW, ReviewCheckoutStatus.CLOSED_FIVE_STAR, ReviewCheckoutStatus.CLOSED_NO_REVIEW, ReviewCheckoutStatus.CLOSED_TRAPPED, ReviewCheckoutStatus.LAUNCH])),
            },
            relations: ['reservationInfo'],
        });

        for (const reviewCheckout of existingReviewCheckouts) {
            //check if there is any review placed or not.
            //If review is placed then close the review checkout
            const review = await this.reviewRepository.findOne({
                where: {
                    reservationId: reviewCheckout.reservationInfo.id,
                    //submittedAt should not be null
                    submittedAt: Not(IsNull()),
                },
                order: {
                    createdAt: 'DESC',
                },
            });
            if (review && review.rating) {
                reviewCheckout.status = review.rating == 10 ? ReviewCheckoutStatus.CLOSED_FIVE_STAR : ReviewCheckoutStatus.CLOSED_BAD_REVIEW;
            }
            // if no review is placed and fourteenDaysAfterCheckout is today then close the review checkout as no review
            if (reviewCheckout.fourteenDaysAfterCheckout < today) {
                reviewCheckout.status = ReviewCheckoutStatus.CLOSED_NO_REVIEW;
            }
            reviewCheckout.updatedAt = new Date();
            reviewCheckout.updatedBy = "system";
            await this.reviewCheckoutRepo.save(reviewCheckout);
        }

        // ---------------------------------------------------------------------------------------------------------------------

        // Step 2: Process today's checkouts to create or update review checkout entries
        // get reservations whose checkout date is today
        const reservationInfoService = new ReservationInfoService();
        const { reservations } = await reservationInfoService.getCheckoutReservations();

        for (const reservation of reservations) {
            logger.info(`Processing review checkout for reservation ID: ${reservation.guestName}`);
            //check if there is review checkout entry
            let reviewCheckout = await this.reviewCheckoutRepo.findOne({
                where: {
                    reservationInfo: { id: reservation.id },
                }
            });
            logger.info(JSON.stringify(reviewCheckout));
            logger.info(`Existing review checkout found: ${reviewCheckout ? 'Yes' : 'No'}`);

            if (!reviewCheckout) {
                const newReviewCheckout = this.reviewCheckoutRepo.create({
                    reservationInfo: reservation,
                    adjustedCheckoutDate: this.getAdjustedDepartureDate(reservation.departureDate),
                    sevenDaysAfterCheckout: format(addDays(reservation.departureDate, 7), 'yyyy-MM-dd'),
                    fourteenDaysAfterCheckout: format(addDays(reservation.departureDate, 14), 'yyyy-MM-dd'),
                    status: ReviewCheckoutStatus.TO_CALL,
                    createdBy: "system",
                });
                reviewCheckout = await this.reviewCheckoutRepo.save(newReviewCheckout);
            } else {
                //check if there is any review placed or not.
                //If review is placed then close the review checkout
                const review = await this.reviewRepository.findOne({
                    where: {
                        reservationId: reservation.id,
                        submittedAt: Not(IsNull()),
                    },
                    order: {
                        createdAt: 'DESC',
                    },
                });
                if (review) {
                    reviewCheckout.status = review.rating == 10 ? ReviewCheckoutStatus.CLOSED_FIVE_STAR : ReviewCheckoutStatus.CLOSED_BAD_REVIEW;
                    reviewCheckout.updatedAt = new Date();
                    reviewCheckout.updatedBy = "system";
                    await this.reviewCheckoutRepo.save(reviewCheckout);
                }
            }
        }
        // ---------------------------------------------------------------------------------------------------------------------

    }

    async updateReviewCheckout(id: number, status: ReviewCheckoutStatus, comments: string, userId: string, isActive?: boolean) {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({ where: { id }, relations: ['reservationInfo'] });
        if (!reviewCheckout) {
            throw CustomErrorHandler.notFound(`Review checkout not found with id: ${id}`);
        }

        reviewCheckout.status = status;
        reviewCheckout.comments = comments;
        reviewCheckout.updatedAt = new Date();
        reviewCheckout.updatedBy = userId;
        if (isActive !== undefined) {
            reviewCheckout.isActive = isActive;
        }
        if (reviewCheckout.status == ReviewCheckoutStatus.CLOSED_BAD_REVIEW) {
            logger.info(`Bad review created for review checkout id: ${id}`);
            await this.createBadReview({
                reservationInfo: reviewCheckout.reservationInfo,
                status: 'New',
                createdBy: userId
            });
        }
        await this.reviewCheckoutRepo.save(reviewCheckout);

        return reviewCheckout;
    }

    async createReviewCheckoutUpdate(reviewCheckoutId: number, updates: string, userId: string) {
        const reviewCheckout = await this.reviewCheckoutRepo.findOne({ where: { id: reviewCheckoutId } });
        if (!reviewCheckout) {
            throw CustomErrorHandler.notFound(`Review checkout not found with id: ${reviewCheckoutId}`);
        }

        const newUpdate = {
            updates,
            createdBy: userId,
            reviewCheckout,
        };

        const reviewCheckoutUpdate = this.reviewCheckoutUpdatesRepo.create(newUpdate);
        return await this.reviewCheckoutUpdatesRepo.save(reviewCheckoutUpdate);
    }

    async deleteLaunchReviewCheckouts() {
        const launchReviewCheckouts = await this.reviewCheckoutRepo.find({
            where: {
                status: ReviewCheckoutStatus.LAUNCH,
            }
        });

        for (const reviewCheckout of launchReviewCheckouts) {
            //updated the deletedAt and deletedBy fields
            reviewCheckout.deletedAt = new Date();
            reviewCheckout.deletedBy = "system";
            await this.reviewCheckoutRepo.save(reviewCheckout);
        }

        logger.info(`Deleted ${launchReviewCheckouts.length} review checkouts with 'Launch' status.`);
    }

    private async createBadReview(obj: any) {
        const newReview = this.badReviewRepo.create(obj);
        return await this.badReviewRepo.save(newReview);
    }

    async updateBadReviewStatus(id: number, status: BadReviewStatus, userId: string) {
        const badReview = await this.badReviewRepo.findOne({ where: { id } });
        if (!badReview) {
            throw CustomErrorHandler.notFound(`Bad review not found with id: ${id}`);
        }
        badReview.status = status;
        badReview.isTodayActive = false;;
        badReview.updatedAt = new Date();
        badReview.updatedBy = userId;
        await this.badReviewRepo.save(badReview);
        return badReview;
    }

    async getBadReviews(filters: FilterBadReviews, userId: string) {
        const {
            page, limit, listingMapId, guestName,
            actionItemsStatus, issuesStatus, channel,
            todayDate, status, tab,
        } = filters;

        //fetch bad reviews list
        const query = this.badReviewRepo
            .createQueryBuilder("badReview")
            .leftJoinAndSelect("badReview.reservationInfo", "reservationInfo")
            .leftJoinAndSelect("badReview.badReviewUpdates", "badReviewUpdates");

        // Tab-based filtering logic
        if (tab) {
            switch (tab.toLowerCase()) {
                case 'today':
                    // Today tab: Show 'New' status + follow up statuses with active today with status call phase
                    query.andWhere(`
                        (badReview.status = :toCallStatus) OR 
                        (badReview.status IN (:followUpStatuses) AND badReview.isTodayActive = true)
                    `, {
                        toCallStatus: BadReviewStatus.NEW,
                        followUpStatuses: [BadReviewStatus.CALL_PHASE],
                    });
                    break;

                case 'active':
                    // Active tab: Show follow up statuses + Issue + No Further Action
                    // Special condition: If sevenDaysAfterCheckout <= todayDate for follow up statuses, 
                    // only show if isActive is true
                    query.andWhere(`
                        (badReview.status IN (:followUpStatuses)) OR
                        (badReview.status IN (:followUpStatuses) AND badReview.isTodayActive = false) OR
                        (badReview.status IN (:activeStatuses))
                    `, {
                        followUpStatuses: [BadReviewStatus.PENDING_REMOVAL],
                        activeStatuses: [BadReviewStatus.CALL_PHASE],
                    });
                    break;

                case 'closed':
                    // Closed tab: Show all closed statuses
                    query.andWhere("badReview.status IN (:...closedStatuses)", {
                        closedStatuses: [
                            BadReviewStatus.CLOSED_FAILED,
                            BadReviewStatus.CLOSED_NO_ACTION_REQUIRED,
                            BadReviewStatus.CLOSED_REMOVED,
                        ]
                    });
                    break;

                default:
                    // If tab is provided but not recognized, use existing status filter logic
                    if (status && status.length > 0) {
                        query.andWhere("badReview.status IN (:...status)", { status });
                    }
                    break;
            }
        } else {
            // Legacy status filter (when no tab is specified)
            if (status && status.length > 0) {
                query.andWhere("badReview.status IN (:...status)", { status });
            }
        }

        // Listing filter
        if (listingMapId && listingMapId.length > 0) {
            query.andWhere("reservationInfo.listingMapId IN (:...listingMapId)", { listingMapId: listingMapId.map(id => Number(id)) });
        }

        // Guest name filter
        if (guestName) {
            query.andWhere("reservationInfo.guestName ILIKE :guestName", { guestName: `${guestName}%` });
        }

        // Channel filter
        if (channel && channel.length > 0) {
            query.andWhere("reservationInfo.channelId IN (:...channel)", { channel: channel.map(id => Number(id)) });
        }

        query.skip((page - 1) * limit).take(limit);
        query.orderBy("badReview.createdAt", "DESC");

        const [badReviewList, total] = await query.getManyAndCount();

        const reservationIds = badReviewList.map(rc => rc.reservationInfo.id);

        // append reviews for each reservations
        const reviews = await this.reviewRepository.find({
            where: {
                reservationId: In(reservationIds),
                isHidden: 0,
            },
            relations: ['reviewDetail', 'reviewDetail.removalAttempts'],
            order: {
                createdAt: 'DESC',
            },
        });

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));

        const issueServices = new IssuesService();
        const actionItemServices = new ActionItemsService();

        const issues = (await issueServices.getGuestIssues({ page: 1, limit: 500, reservationId: reservationIds, status: issuesStatus }, userId)).issues;
        const actionItems = (await actionItemServices.getActionItems({ page: 1, limit: 500, reservationId: reservationIds, status: actionItemsStatus })).actionItems;

        const transformedData = badReviewList.map(rc => {
            return {
                ...rc,
                assignee: userMap.get(rc.assignee) || rc.assignee,
                createdBy: userMap.get(rc.createdBy) || rc.createdBy,
                updatedBy: userMap.get(rc.updatedBy) || rc.updatedBy,
                reservationInfo: {
                    ...rc.reservationInfo,
                    review: reviews.find(r => r.reservationId == rc.reservationInfo?.id) || null,
                    issues: issues.filter(issue => Number(issue.reservation_id) == rc.reservationInfo?.id) || null,
                    actionItems: actionItems.filter(item => item.reservationId == rc.reservationInfo?.id) || null,
                },
                badReviewUpdates: rc.badReviewUpdates.map(update => {
                    return {
                        ...update,
                        createdBy: userMap.get(update.createdBy) || update.createdBy,
                        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                    };
                }),
                reviews: reviews.filter(r => r.reservationId == rc.reservationInfo?.id) || [],
            };
        });

        return { result: transformedData, total };
    }

    async createBadReviewUpdate(badReviewId: number, updates: string, userId: string) {
        const badReview = await this.badReviewRepo.findOne({ where: { id: badReviewId } });
        if (!badReview) {
            throw CustomErrorHandler.notFound(`Bad review not found with id: ${badReviewId}`);
        }

        const newUpdate = {
            updates,
            createdBy: userId,
            badReview,
        };

        const badReviewUpdate = this.badReviewUpdatesRepo.create(newUpdate);
        return await this.badReviewUpdatesRepo.save(badReviewUpdate);
    }

    async updateBadReviewStatusForCallPhaseDaily() {
        await this.badReviewRepo
            .createQueryBuilder()
            .update(BadReviewEntity)
            .set({ isTodayActive: true })
            .where('status = :status', { status: BadReviewStatus.CALL_PHASE })
            .execute();
    }


}
