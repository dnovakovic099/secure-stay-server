import { HostAwayClient } from "../client/HostAwayClient";
import { ReviewEntity } from "../entity/Review";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ReservationService } from "./ReservationService";

export class ReviewService {
    private hostawayClient = new HostAwayClient();
    private reviewRepository = appDatabase.getRepository(ReviewEntity);

    public async getReviews(userId: string, listingId?: number) {
        try {
            const reviews = await this.reviewRepository.find({ ...(listingId ? { where: { listingMapId: listingId } } : "") });
            return reviews;
        } catch (error) {
            logger.error(`Failed to get review`, error);
            throw error;
        }
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
                        channelName: channelList.find(channel => channel.channelId == reviewData.channelId).channelName
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
                        channelName: channelList.find(channel => channel.channelId == reviewData.channelId).channelName
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
