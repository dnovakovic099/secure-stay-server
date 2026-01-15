import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between } from "typeorm";

export class CleanerNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private openPhoneService = new OpenPhoneService();

    /**
     * Send checkout notification SMS to cleaner
     */
    async sendCheckoutNotification(reservationId: number): Promise<void> {
        try {
            // Check if feature is enabled
            if (process.env.ENABLE_CLEANER_CHECKOUT_SMS !== 'true') {
                logger.info(`[CleanerNotification] Feature disabled for reservation ${reservationId}`);
                return;
            }

            logger.info(`[CleanerNotification] Processing checkout notification for reservation ${reservationId}`);

            // Fetch reservation details
            const reservation = await this.reservationRepo.findOne({
                where: { id: reservationId }
            });

            if (!reservation) {
                logger.error(`[CleanerNotification] Reservation ${reservationId} not found`);
                return;
            }

            // Fetch or create post-stay audit record
            let postStay = await this.postStayRepo.findOne({
                where: { reservationId }
            });

            if (!postStay) {
                // Create a new post-stay record
                postStay = this.postStayRepo.create({
                    reservationId,
                    cleanerNotificationStatus: 'pending'
                });
                await this.postStayRepo.save(postStay);
            }

            // Determine which cleaner to notify
            const cleaner = await this.getNotificationCleaner(reservation, postStay);

            if (!cleaner) {
                // Check if error was already set by getNotificationCleaner (e.g., multiple cleaners)
                const currentPostStay = await this.postStayRepo.findOne({
                    where: { reservationId }
                });

                // Only update if no error has been set yet
                if (!currentPostStay?.cleanerNotificationError) {
                    await this.updateNotificationStatus(
                        reservationId,
                        'skipped',
                        'No active cleaner found for this listing'
                    );
                }
                return;
            }

            // Fetch listing for address
            const listing = await this.listingRepo.findOne({
                where: { id: reservation.listingMapId }
            });

            if (!listing) {
                await this.updateNotificationStatus(
                    reservationId,
                    'skipped',
                    'Listing information not found'
                );
                return;
            }

            // Fetch approved upsells
            const upsells = await this.getApprovedUpsells(reservation);

            // Compose SMS message
            const message = this.composeCheckoutMessage(reservation, listing, upsells);

            // Format cleaner phone number
            const phoneNumber = this.openPhoneService.formatPhoneNumber('+1', cleaner.contact);

            if (!phoneNumber) {
                await this.updateNotificationStatus(
                    reservationId,
                    'failed',
                    `Invalid phone number for cleaner: ${cleaner.contact || 'not provided'}`
                );
                return;
            }

            // Check if OpenPhone is configured before attempting to send
            if (!process.env.OPEN_PHONE_API_KEY) {
                await this.updateNotificationStatus(
                    reservationId,
                    'failed',
                    'OpenPhone is not configured. Please set OPEN_PHONE_API_KEY environment variable.'
                );
                return;
            }

            if (!process.env.OPEN_PHONE_SENDER_NUMBER) {
                await this.updateNotificationStatus(
                    reservationId,
                    'failed',
                    'OPEN_PHONE_SENDER_NUMBER not configured, cannot send SMS'
                );
                return;
            }

            // Send SMS via OpenPhone
            await this.openPhoneService.sendSMS(phoneNumber, message);

            // Update status to sent
            await this.updateNotificationStatus(reservationId, 'sent');

            logger.info(`[CleanerNotification] SMS sent successfully to ${cleaner.name} for reservation ${reservationId}`);

        } catch (error: any) {
            logger.error(`[CleanerNotification] Error sending checkout notification for reservation ${reservationId}:`, error.message);
            await this.updateNotificationStatus(
                reservationId,
                'failed',
                error.message || 'Unknown error occurred while sending SMS'
            );
        }
    }

    /**
     * Get the cleaner contact to notify
     */
    private async getNotificationCleaner(
        reservation: ReservationInfoEntity,
        postStay: ReservationDetailPostStayAudit
    ): Promise<Contact | null> {
        // Check if there's a per-reservation override
        if (postStay.cleanerNotificationContactId) {
            const overrideCleaner = await this.contactRepo.findOne({
                where: { id: postStay.cleanerNotificationContactId }
            });

            if (overrideCleaner) {
                logger.info(`[CleanerNotification] Using override cleaner: ${overrideCleaner.name}`);
                return overrideCleaner;
            }
        }

        // Query for active cleaners
        const activeCleaners = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });

        if (activeCleaners.length === 0) {
            logger.warn(`[CleanerNotification] No active cleaners found for listing ${reservation.listingMapId}`);
            return null;
        }

        if (activeCleaners.length > 1) {
            logger.warn(`[CleanerNotification] Multiple active cleaners found for listing ${reservation.listingMapId}`);
            await this.updateNotificationStatus(
                reservation.id,
                'skipped',
                'Multiple active cleaners found for this listing. Please ensure only one cleaner has status \'active\'.'
            );
            return null;
        }

        logger.info(`[CleanerNotification] Using active cleaner: ${activeCleaners[0].name}`);
        return activeCleaners[0];
    }

    /**
     * Get approved upsells for the reservation
     */
    private async getApprovedUpsells(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            // Get the booking ID from reservation
            const bookingId = reservation.hostawayReservationId || reservation.reservationId;

            if (!bookingId) {
                return [];
            }

            // Fetch post-stay to get approved upsells
            const postStay = await this.postStayRepo.findOne({
                where: { reservationId: reservation.id }
            });

            if (!postStay || !postStay.approvedUpsells) {
                return [];
            }

            // Parse approved upsells (it's stored as JSON string)
            const approvedUpsellIds = JSON.parse(postStay.approvedUpsells || '[]');

            if (!Array.isArray(approvedUpsellIds) || approvedUpsellIds.length === 0) {
                return [];
            }

            // Fetch upsells matching the booking
            const upsells = await this.upsellRepo.find({
                where: { booking_id: bookingId }
            });

            // Filter only approved ones
            return upsells.filter(upsell => approvedUpsellIds.includes(upsell.id));

        } catch (error: any) {
            logger.error(`[CleanerNotification] Error fetching upsells:`, error.message);
            return [];
        }
    }

    /**
     * Compose the checkout SMS message
     */
    private composeCheckoutMessage(
        reservation: ReservationInfoEntity,
        listing: Listing,
        upsells: UpsellOrder[]
    ): string {
        const lines: string[] = [];

        // Header
        lines.push(`${listing.internalListingName} Checkout Notification`);
        lines.push('');

        // Address
        lines.push(`Address: ${listing.address}`);
        lines.push('');

        // Reservation details
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName}`);

        // Format checkout date
        const checkoutDate = reservation.departureDate
            ? new Date(reservation.departureDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            })
            : 'N/A';
        lines.push(`Checkout Date: ${checkoutDate}`);
        lines.push('');

        // Upsells
        if (upsells && upsells.length > 0) {
            lines.push('Approved Upsells:');
            upsells.forEach(upsell => {
                lines.push(`- ${upsell.type}`);
            });
        } else {
            lines.push('No approved upsells for this reservation.');
        }

        lines.push('');
        lines.push('Please ensure property is cleaned and restocked.');

        return lines.join('\n');
    }

    /**
     * Update notification status in database
     */
    private async updateNotificationStatus(
        reservationId: number,
        status: 'pending' | 'sent' | 'failed' | 'skipped',
        error?: string
    ): Promise<void> {
        try {
            const postStay = await this.postStayRepo.findOne({
                where: { reservationId }
            });

            if (!postStay) {
                logger.error(`[CleanerNotification] Post-stay record not found for reservation ${reservationId}`);
                return;
            }

            postStay.cleanerNotificationStatus = status;
            postStay.cleanerNotificationError = error || null;

            if (status === 'sent') {
                postStay.cleanerNotificationSentAt = new Date();
            }

            await this.postStayRepo.save(postStay);

            logger.info(`[CleanerNotification] Updated status to '${status}' for reservation ${reservationId}`);

        } catch (err: any) {
            logger.error(`[CleanerNotification] Error updating notification status:`, err.message);
        }
    }
}
