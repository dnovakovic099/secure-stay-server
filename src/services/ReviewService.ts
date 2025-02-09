import { Between, In, LessThan, Not } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReservationService } from "./ReservationService";
import { OwnerInfoEntity } from "../entity/OwnerInfo";

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
                ...(rating !== undefined ? { rating: LessThan(rating) } : {}),
                ...(listingIds.length > 0 ? { listingMapId: In(listingIds) } : {})
            };

            if (fromDate !== undefined && toDate !== undefined) {
                condition.submittedAt = Between(fromDate, toDate);
            }

            const reviewDetailCondition: Record<string, any> = {};
            if (claimResolutionStatus !== undefined) {
                reviewDetailCondition.claimResolutionStatus = claimResolutionStatus;
            }
            if (status !== undefined) {
                reviewDetailCondition.status = status;
            }

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
                        isHidden: reviewData?.isHidden || 0,
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

}
