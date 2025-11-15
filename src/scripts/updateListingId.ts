import logger from "../utils/logger.utils";
import { appDatabase } from "../utils/database.util";
import { ListingDetail } from "../entity/ListingDetails";
import { listingIdMappings } from "../constant";
import { ListingSchedule } from "../entity/ListingSchedule";
import { PartnershipInfoEntity } from "../entity/PartnershipInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Contact } from "../entity/Contact";
import { RefundRequestEntity } from "../entity/RefundRequest";
import { Maintenance } from "../entity/Maintenance";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientTicket } from "../entity/ClientTicket";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ActionItems } from "../entity/ActionItems";
import { Issue } from "../entity/Issue";
import { Claim } from "../entity/Claim";
import { Task } from "../entity/Task";
import { ExpenseEntity } from "../entity/Expense";
import { Resolution } from "../entity/Resolution";
import { ReviewEntity } from "../entity/Review";
import { BadReviewEntity } from "../entity/BadReview";
import { LiveIssue } from "../entity/LiveIssue";

export async function updateListingId() {
    logger.info("Updating listing IDs...");

    //update the listingId with the new listingId
    await appDatabase.manager.transaction(async (tx) => {

        for (const mapping of listingIdMappings) {
            const { hostaway_id, hostify_id } = mapping;

            // Update ListingDetail
            await tx.update(ListingDetail, { listingId: hostaway_id }, { listingId: hostify_id });

            // Update ListingSchedule
            await tx.update(ListingSchedule, { listingId: hostaway_id }, { listingId: hostify_id });

            // Update PartnershipInfoEntity
            await tx.update(PartnershipInfoEntity, { listingId: hostaway_id }, { listingId: hostify_id });

            // update UpsellOrder
            await tx.update(UpsellOrder, { listing_id: hostaway_id }, { listing_id: String(hostify_id) });

            // update contacts
            await tx.update(Contact, { listingId: hostaway_id }, { listingId: String(hostify_id) });

            //update refund_request_info
            await tx.update(RefundRequestEntity, { listingId: hostaway_id }, { listingId: hostify_id });

            //update maintenance_
            await tx.update(Maintenance, { listingId: hostaway_id }, { listingId: String(hostify_id) });

            //update client_property
            await tx.update(ClientPropertyEntity, { listingId: hostaway_id }, { listingId: String(hostify_id) });

            //update client_ticket
            await tx.update(ClientTicket, { listingId: hostaway_id }, { listingId: String(hostify_id) });

            //update reservation_page
            await tx.update(ReservationInfoEntity, { listingMapId: hostaway_id }, { listingMapId: hostify_id });

            //update action_items
            await tx.update(ActionItems, { listingId: hostaway_id }, { listingId: hostify_id });

            //update issues
            await tx.update(Issue, { listing_id: hostaway_id }, { listing_id: String(hostify_id) });

            //update claims
            await tx.update(Claim, { listing_id: hostaway_id }, { listing_id: String(hostify_id) });

            //update task 
            await tx.update(Task, { listing_id: hostaway_id }, { listing_id: String(hostify_id) });

            //update expense 
            await tx.update(ExpenseEntity, { listingMapId: hostaway_id }, { listingMapId: hostify_id });

            //update resolution
            await tx.update(Resolution, { listingMapId: hostaway_id }, { listingMapId: hostify_id });

            //update reviews
            await tx.update(ReviewEntity, { listingMapId: hostaway_id }, { listingMapId: hostify_id });

            //update live issues
            await tx.update(LiveIssue, { propertyId: hostaway_id }, { propertyId: hostify_id });
        }

    });

    logger.info("Listing ID update completed successfully.");
}