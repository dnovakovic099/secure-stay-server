import { IsNull, In } from "typeorm";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";
import { subDays, isAfter, format } from "date-fns";
import redis from "../utils/redisConnection";

interface ListingWithLastBooking {
    listing: Listing;
    lastBookingDate: string | null;
}

/**
 * Service for detecting listings that haven't received any bookings for 7 days
 * and sending email notifications to administrators.
 */
export class NoBookingAlertService {
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    // Configurable email recipients
    private recipients = [
        "admin@luxurylodgingpm.com",
        "ferdinand@luxurylodgingpm.com",
        "prasannakb440@gmail.com"
    ];

    // Valid booking statuses to count (confirmed bookings)
    private validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];

    // Cooldown period in days
    private cooldownDays = 7;

    // No-booking threshold in days
    private noBookingThresholdDays = 7;

    /**
     * Get Redis cooldown key for a listing
     */
    private getCooldownKey(listingId: number): string {
        return `no_booking_alert:${listingId}`;
    }

    /**
     * Main method to check all listings and trigger alerts for those without recent bookings
     */
    async checkAndTriggerAlerts(): Promise<void> {
        try {
            logger.info('[NoBookingAlertService] Starting no-booking check...');

            // Get all listings without recent bookings
            const flaggedListings = await this.getListingsWithoutRecentBookings();

            if (flaggedListings.length === 0) {
                logger.info('[NoBookingAlertService] All listings have recent bookings. No alerts to send.');
                return;
            }

            // Filter out listings that are on cooldown
            const listingsToAlert: ListingWithLastBooking[] = [];

            for (const item of flaggedListings) {
                const cooldownKey = this.getCooldownKey(item.listing.id);
                const isOnCooldown = await redis.get(cooldownKey);

                if (isOnCooldown) {
                    logger.info(`[NoBookingAlertService] Listing ${item.listing.id} (${item.listing.internalListingName}) is on cooldown. Skipping.`);
                    continue;
                }

                listingsToAlert.push(item);
            }

            if (listingsToAlert.length === 0) {
                logger.info('[NoBookingAlertService] All flagged listings are on cooldown. No alerts to send.');
                return;
            }

            // Send consolidated email
            await this.sendNoBookingAlertEmail(listingsToAlert);

            // Set cooldown for all alerted listings
            for (const item of listingsToAlert) {
                const cooldownKey = this.getCooldownKey(item.listing.id);
                await redis.setex(cooldownKey, this.cooldownDays * 24 * 60 * 60, 'true');
                logger.info(`[NoBookingAlertService] Set ${this.cooldownDays}-day cooldown for listing ${item.listing.id}`);
            }

            logger.info(`[NoBookingAlertService] Alert sent for ${listingsToAlert.length} listing(s).`);

        } catch (error) {
            logger.error(`[NoBookingAlertService] Error checking for listings without bookings: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all active listings that haven't received any bookings in the last 7 days
     */
    private async getListingsWithoutRecentBookings(): Promise<ListingWithLastBooking[]> {
        // Get all active listings (not soft-deleted)
        const allListings = await this.listingRepo.find({
            where: { deletedAt: IsNull() }
        });

        logger.info(`[NoBookingAlertService] Found ${allListings.length} active listings to check.`);

        const thresholdDate = subDays(new Date(), this.noBookingThresholdDays);
        const flaggedListings: ListingWithLastBooking[] = [];

        for (const listing of allListings) {
            // Get all reservations for this listing with valid statuses
            const reservations = await this.reservationRepo.find({
                where: {
                    listingMapId: listing.id,
                    status: In(this.validStatuses)
                },
                order: { reservationDate: 'DESC' }
            });

            // Check if there are any bookings within the threshold period
            // reservationDate is stored as a string in the format YYYY-MM-DD
            const hasRecentBooking = reservations.some(r => {
                if (!r.reservationDate) return false;
                const bookingDate = new Date(r.reservationDate);
                return isAfter(bookingDate, thresholdDate);
            });

            if (!hasRecentBooking) {
                // Get the last booking date for this listing
                const lastBookingDate = reservations.length > 0 ? reservations[0].reservationDate : null;

                flaggedListings.push({
                    listing,
                    lastBookingDate
                });
            }
        }

        logger.info(`[NoBookingAlertService] Found ${flaggedListings.length} listing(s) without recent bookings.`);
        return flaggedListings;
    }

    /**
     * Send email notification for listings without recent bookings
     */
    private async sendNoBookingAlertEmail(listings: ListingWithLastBooking[]): Promise<void> {
        const subject = `ALERT - ${listings.length} Listing(s) Without Bookings for 7 Days`;

        const tableRows = listings.map(item => {
            // Format the last booking date as "Jan 12, 2026"
            let formattedDate = 'Never';
            if (item.lastBookingDate) {
                try {
                    formattedDate = format(new Date(item.lastBookingDate), 'MMM d, yyyy');
                } catch {
                    formattedDate = item.lastBookingDate;
                }
            }

            return `
            <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.listing.id}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.listing.internalListingName || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${formattedDate}</td>
            </tr>
        `;
        }).join("");

        const html = `
            <h2>No Booking Alert</h2>
            <p>The following listing(s) have not received any new bookings in the last <strong>7 days</strong>:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Listing ID</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Internal Name</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Last Booking Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            <p style="margin-top: 16px;">Please review these listings and take appropriate action to increase bookings.</p>
            <p>Regards,<br><strong>Secure Stay</strong></p>
        `;

        const from = process.env.EMAIL_FROM;
        const to = this.recipients.join(", ");

        if (this.recipients.length > 0) {
            await sendEmail(subject, html, from, to);
            logger.info(`[NoBookingAlertService] Alert email sent for ${listings.length} listing(s)`);
        } else {
            logger.warn('[NoBookingAlertService] No recipients configured for no-booking alert.');
        }
    }
}
