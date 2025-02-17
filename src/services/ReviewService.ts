import { Between, In, IsNull, LessThan, LessThanOrEqual, Not } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReservationService } from "./ReservationService";
import { OwnerInfoEntity } from "../entity/OwnerInfo";
import sendEmail from "../utils/sendEmai";
import CustomErrorHandler from "../middleware/customError.middleware";

interface ProcessedReview extends ReviewEntity {
    unresolvedForMoreThanThreeDays: boolean;
    unresolvedForMoreThanSevenDays: boolean;
}

export class ReviewService {
    private hostawayClient = new HostAwayClient();
    private reviewRepository = appDatabase.getRepository(ReviewEntity);
    private ownerInfoRepository = appDatabase.getRepository(OwnerInfoEntity);

    public async getReviews({ fromDate, toDate, listingId, page, limit, rating, owner, claimResolutionStatus, status, isClaimOnly }) {
        try {
            let listingIds = [];
            if (!listingId && owner) {
                listingIds = await this.getListingIdsByOwnerName(owner);
            }

            const condition: Record<string, any> = {
                ...(listingId ? { listingMapId: listingId } : {}),
                ...(rating !== undefined ? { rating: LessThanOrEqual(rating) } : { rating: Not(IsNull()) }),
                ...(listingIds.length > 0 ? { listingMapId: In(listingIds) } : {})
            };

            if (fromDate !== undefined && toDate !== undefined) {
                condition.submittedAt = Between(fromDate, toDate);
            }

            const reviewDetailCondition: Record<string, any> = {};
            if (claimResolutionStatus !== undefined) {
                reviewDetailCondition.claimResolutionStatus = claimResolutionStatus;
            }

            condition.isHidden = status == "active" ? 0 : 1;

            // Apply isClaimOnly condition
            if (isClaimOnly && claimResolutionStatus == undefined) {
                reviewDetailCondition.claimResolutionStatus = Not("N/A");
            }

            const [reviews, totalCount] = await this.reviewRepository.findAndCount({
                where: {
                    ...condition,
                    reviewDetail: reviewDetailCondition,
                },
                relations: ['reviewDetail'],
                skip: (page - 1) * limit,
                take: limit,
                order: {
                    rating: 'ASC',
                    submittedAt: 'DESC',
                },
            });

            return { reviews, totalCount };
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


    public async updateReviewVisibility(reviewVisibility: string, id: number, userId: string) {
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
                }
            }
        } catch (error) {
            logger.error("Error syncing reviews:", error);
            throw error;
        }
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

}
