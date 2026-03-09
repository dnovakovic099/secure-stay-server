import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";

// Import or create a PreStayAudit entity if it doesn't exist
// For now, we'll store notification status in a similar pattern

interface PreStayNotificationStatus {
    reservationId: number;
    contactId?: number;
    status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused';
    sentAt?: Date;
    error?: string;
}

export class CheckInNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private openPhoneService = new OpenPhoneService();

    // In-memory cache for notification status (should be moved to DB in production)
    private notificationStatus: Map<number, PreStayNotificationStatus> = new Map();

    /**
     * Send check-in notification SMS to cleaner/property contact
     * @param reservationId - The reservation ID
     * @param forceManual - If true, bypasses the feature toggle check (for manual retries)
     */
    async sendCheckInNotification(reservationId: number, forceManual: boolean = false): Promise<void> {
        try {
            // Check if feature is enabled (skip check for manual sends)
            if (!forceManual && process.env.ENABLE_CHECKIN_NOTIFICATION_SMS !== 'true') {
                logger.info(`[CheckInNotification] Feature disabled for reservation ${reservationId}`);
                throw new Error('Check-in notification feature is disabled. Set ENABLE_CHECKIN_NOTIFICATION_SMS=true to enable.');
            }

            logger.info(`[CheckInNotification] Processing check-in notification for reservation ${reservationId}`);

            // Fetch reservation details
            const reservation = await this.reservationRepo.findOne({
                where: { id: reservationId }
            });

            if (!reservation) {
                logger.error(`[CheckInNotification] Reservation ${reservationId} not found`);
                throw new Error(`Reservation ${reservationId} not found`);
            }

            // Check if notification already sent
            const existingStatus = this.notificationStatus.get(reservationId);
            if (existingStatus?.status === 'sent') {
                logger.info(`[CheckInNotification] Notification already sent for reservation ${reservationId}`);
                return;
            }

            // Determine which contact to notify
            const contact = await this.getNotificationContact(reservation, existingStatus?.contactId);

            if (!contact) {
                this.updateStatus(reservationId, 'skipped', 'No active contact found for this listing');
                throw new Error('No active contact found for this listing. Please add a cleaner contact first.');
            }

            // Fetch listing for address
            const listing = await this.listingRepo.findOne({
                where: { id: reservation.listingMapId }
            });

            if (!listing) {
                this.updateStatus(reservationId, 'skipped', 'Listing information not found');
                throw new Error('Listing information not found for this reservation');
            }

            // Fetch early check-in upsells
            const upsells = await this.getEarlyCheckInUpsells(reservation);

            // Compose SMS message
            const message = this.composeCheckInMessage(reservation, listing, upsells);

            // Format contact phone number
            const phoneNumber = this.openPhoneService.formatPhoneNumber('+1', contact.contact);

            if (!phoneNumber) {
                this.updateStatus(reservationId, 'failed', `Invalid phone number for contact: ${contact.contact || 'not provided'}`);
                throw new Error(`Invalid phone number for contact ${contact.name}: ${contact.contact || 'not provided'}`);
            }

            // Check if OpenPhone is configured
            if (!process.env.OPEN_PHONE_API_KEY) {
                this.updateStatus(reservationId, 'failed', 'OpenPhone is not configured');
                throw new Error('OpenPhone API is not configured. Please set OPEN_PHONE_API_KEY environment variable.');
            }

            // Use dedicated sender number (reuse checkout sender or create new env var)
            const senderNumber = process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
            if (!senderNumber) {
                this.updateStatus(reservationId, 'failed', 'SMS sender number not configured');
                throw new Error('SMS sender number not configured. Please set CHECKIN_SMS_SENDER_NUMBER or CLEANER_CHECKOUT_SMS_SENDER_NUMBER environment variable.');
            }
            
            logger.info(`[CheckInNotification] Sending SMS to ${phoneNumber} via ${senderNumber}`);

            // Send SMS via OpenPhone
            await this.openPhoneService.sendSMSWithSender(phoneNumber, message, senderNumber);

            // Update status to sent
            this.updateStatus(reservationId, 'sent');

            logger.info(`[CheckInNotification] SMS sent successfully to ${contact.name} for reservation ${reservationId}`);

        } catch (error: any) {
            logger.error(`[CheckInNotification] Error sending check-in notification for reservation ${reservationId}:`, error.message);
            this.updateStatus(reservationId, 'failed', error.message || 'Unknown error');
        }
    }

    /**
     * Get the contact to notify (cleaner or property manager)
     */
    private async getNotificationContact(
        reservation: ReservationInfoEntity,
        overrideContactId?: number
    ): Promise<Contact | null> {
        // Check if there's a per-reservation override
        if (overrideContactId) {
            const overrideContact = await this.contactRepo.findOne({
                where: { id: overrideContactId }
            });

            if (overrideContact) {
                logger.info(`[CheckInNotification] Using override contact: ${overrideContact.name}`);
                return overrideContact;
            }
        }

        // Query for active cleaners or property managers
        const activeContacts = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner', // Could also include 'Property Manager'
                status: 'active',
                deletedAt: null as any
            }
        });

        if (activeContacts.length === 0) {
            logger.warn(`[CheckInNotification] No active contacts found for listing ${reservation.listingMapId}`);
            return null;
        }

        if (activeContacts.length > 1) {
            logger.warn(`[CheckInNotification] Multiple active contacts found for listing ${reservation.listingMapId}`);
            // Return the first one, or implement selection logic
        }

        logger.info(`[CheckInNotification] Using contact: ${activeContacts[0].name}`);
        return activeContacts[0];
    }

    /**
     * Get early check-in upsells for the reservation
     */
    private async getEarlyCheckInUpsells(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            const bookingId = reservation.hostawayReservationId || reservation.reservationId;

            if (!bookingId) {
                return [];
            }

            // Fetch upsells matching the booking and type
            const upsells = await this.upsellRepo.find({
                where: { 
                    booking_id: bookingId,
                    // Could filter by type like 'early_checkin' if available
                }
            });

            // Filter for early check-in related upsells
            return upsells.filter(u => 
                u.type?.toLowerCase().includes('early') || 
                u.type?.toLowerCase().includes('check-in') ||
                u.type?.toLowerCase().includes('checkin')
            );

        } catch (error: any) {
            logger.error(`[CheckInNotification] Error fetching upsells:`, error.message);
            return [];
        }
    }

    /**
     * Compose the check-in SMS message
     * 
     * Template:
     * <listing nickname> Check-In Notification
     * 
     * Address: 210 West Saint Paul Avenue, Chicago, 60614,
     * 
     * Reservation #<reservation id>
     * Guest: <guest name>
     * Check-In Date: <Check-in date>
     * 
     * <upsell information>
     */
    private composeCheckInMessage(
        reservation: ReservationInfoEntity,
        listing: Listing,
        upsells: UpsellOrder[]
    ): string {
        const lines: string[] = [];

        // Header
        lines.push(`${listing.internalListingName} Check-In Notification`);
        lines.push('');

        // Address
        lines.push(`Address: ${listing.address}`);
        lines.push('');

        // Reservation details
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName}`);

        // Format check-in date
        const checkInDate = reservation.arrivalDate
            ? new Date(reservation.arrivalDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            })
            : 'N/A';
        lines.push(`Check-In Date: ${checkInDate}`);
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

        return lines.join('\n');
    }

    /**
     * Update notification status
     */
    private updateStatus(
        reservationId: number,
        status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused',
        error?: string
    ): void {
        const existing = this.notificationStatus.get(reservationId) || { reservationId, status: 'pending' };
        
        this.notificationStatus.set(reservationId, {
            ...existing,
            status,
            error: error || undefined,
            sentAt: status === 'sent' ? new Date() : existing.sentAt
        });

        logger.info(`[CheckInNotification] Updated status to '${status}' for reservation ${reservationId}`);
    }

    /**
     * Get today's check-ins that need notifications
     */
    async getTodaysCheckIns(): Promise<ReservationInfoEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const reservations = await this.reservationRepo.find({
            where: {
                arrivalDate: Between(today, tomorrow),
                status: 'accepted' // Or whatever status indicates active booking
            }
        });

        return reservations;
    }

    /**
     * Process all check-in notifications for today
     */
    async processAllTodaysCheckIns(): Promise<{ sent: number; failed: number; skipped: number }> {
        const reservations = await this.getTodaysCheckIns();
        
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const reservation of reservations) {
            try {
                await this.sendCheckInNotification(reservation.id);
                
                const status = this.notificationStatus.get(reservation.id);
                if (status?.status === 'sent') sent++;
                else if (status?.status === 'failed') failed++;
                else if (status?.status === 'skipped') skipped++;
            } catch (error) {
                failed++;
            }
        }

        logger.info(`[CheckInNotification] Processed ${reservations.length} check-ins: ${sent} sent, ${failed} failed, ${skipped} skipped`);
        
        return { sent, failed, skipped };
    }
}
