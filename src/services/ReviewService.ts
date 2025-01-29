import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";
import { ConnectedAccountService } from "./ConnectedAccountService";

export class ReviewService {
    private hostawayClient = new HostAwayClient();

    public async getReviews(userId: string, listingId?: number) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);
            const reviews = await this.hostawayClient.getReviews(clientId, clientSecret, 500, listingId);
            const filteredReviews = reviews.filter(review => review.rating < 10 && review.rating !== null);
            return filteredReviews;
        } catch (error) {
            logger.error(`Failed to get review`, error);
            throw new Error("Failed to get review");
        }
    }

}
