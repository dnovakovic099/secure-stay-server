import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ClientEntity } from "../entity/Client";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between, LessThanOrEqual, MoreThanOrEqual, In } from "typeorm";
import { renderTurnoverTemplate, summarizeTemplateErrors } from "../utils/turnoverTemplate.util";

import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { DoorCodeStatus, CompletionStatus, InventoryCheckStatus, CleanlinessCheck, CleanerCheck, CleanerNotified, DamageCheck } from "../entity/ReservationDetailPreStayAudit";


export class CheckInNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private preStayAuditRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
    private openPhoneService = new OpenPhoneService();

    /**
     * Send check-in notification SMS to cleaner/property contact
     * @param reservationId - The reservation ID
     * @param forceManual - If true, bypasses the feature toggle check (for manual retries)
     */
    async sendCheckInNotification(reservationId: number, forceManual: boolean = false): Promise<void> {
        try {
            void forceManual;
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
            const existingAudit = await this.preStayAuditRepo.findOne({ where: { reservationId } });
            if (existingAudit?.notificationStatus === 'sent') {
                logger.info(`[CheckInNotification] Notification already sent for reservation ${reservationId}`);
                return;
            }

            // Fetch listing for address
            const listing = await this.listingRepo.findOne({
                where: { id: reservation.listingMapId }
            });

            if (!listing) {
                await this.updateStatus(reservationId, 'skipped', 'Listing information not found');
                throw new Error('Listing information not found for this reservation');
            }

            const settings = await this.getEffectiveSettings(listing.id);
            if (!settings.preStayEnabled) {
                await this.updateStatus(reservationId, 'skipped', 'Pre-stay turnover messages are disabled for this property');
                return;
            }
            if (settings.sameDayCombinedEnabled && await this.hasSameDayCheckout(reservation, listing)) {
                await this.updateStatus(reservationId, 'skipped', 'Same-day turnover is enabled; pre-stay message is suppressed by the combined same-day rule');
                return;
            }

            // Determine which contact to notify
            const contact = await this.getNotificationContact(reservation, existingAudit?.notificationContactId ?? undefined, settings.preStayRecipientIds);

            if (!contact) {
                await this.updateStatus(reservationId, 'skipped', 'No enabled pre-stay recipient found for this listing');
                throw new Error('No enabled pre-stay recipient found for this listing.');
            }

            // Fetch early check-in upsells
            const upsells = await this.getEarlyCheckInUpsells(reservation);

            // Compose SMS message
            const rendered = renderTurnoverTemplate(settings.preStayMessageTemplate, {
                reservation,
                listing,
                upsells,
                ownerName: settings.ownerName,
                ownerEmail: settings.ownerEmail,
                ownerPhone: settings.ownerPhone
            });
            const templateError = summarizeTemplateErrors(rendered);
            if (rendered.blocked) {
                await this.updateStatus(reservationId, 'skipped', templateError || 'Template variables could not be populated');
                return;
            }
            const message = rendered.message;

            // Format contact phone number
            const phoneNumber = this.openPhoneService.formatPhoneNumber('+1', contact.contact);

            if (!phoneNumber) {
                await this.updateStatus(reservationId, 'failed', `Invalid phone number for contact: ${contact.contact || 'not provided'}`);
                throw new Error(`Invalid phone number for contact ${contact.name}: ${contact.contact || 'not provided'}`);
            }

            // Check if OpenPhone is configured
            if (!process.env.OPEN_PHONE_API_KEY) {
                await this.updateStatus(reservationId, 'failed', 'OpenPhone is not configured');
                throw new Error('OpenPhone API is not configured. Please set OPEN_PHONE_API_KEY environment variable.');
            }

            // Use dedicated sender number (reuse checkout sender or create new env var)
            const senderNumber = process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
            if (!senderNumber) {
                await this.updateStatus(reservationId, 'failed', 'SMS sender number not configured');
                throw new Error('SMS sender number not configured. Please set CHECKIN_SMS_SENDER_NUMBER or CLEANER_CHECKOUT_SMS_SENDER_NUMBER environment variable.');
            }
            
            logger.info(`[CheckInNotification] Sending SMS to ${phoneNumber} via ${senderNumber}`);

            // Send SMS via OpenPhone
            await this.openPhoneService.sendSMSWithSender(phoneNumber, message, senderNumber);

            // Update status to sent
            await this.updateStatus(reservationId, 'sent', templateError || undefined, contact.id, message);

            logger.info(`[CheckInNotification] SMS sent successfully to ${contact.name} for reservation ${reservationId}`);

        } catch (error: any) {
            logger.error(`[CheckInNotification] Error sending check-in notification for reservation ${reservationId}:`, error.message);
            await this.updateStatus(reservationId, 'failed', error.message || 'Unknown error');
        }
    }

    /**
     * Get the contact to notify (cleaner or property manager)
     */
    private async getNotificationContact(
        reservation: ReservationInfoEntity,
        overrideContactId?: number,
        recipientIds?: string[]
    ): Promise<{ id?: number; name: string; contact?: string | null; role?: string | null } | null> {
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

        const contactIds = (recipientIds || [])
            .filter((id) => id.startsWith('contact:'))
            .map((id) => Number(id.split(':')[1]))
            .filter((id) => Number.isFinite(id));
        if ((recipientIds || []).length > 0) {
            if (contactIds.length > 0) {
                const configuredContacts = await this.contactRepo.find({
                    where: {
                        id: In(contactIds),
                        status: In(['active', 'active-backup'] as any),
                        deletedAt: null as any
                    }
                });
                if (configuredContacts.length > 0) {
                    logger.info(`[CheckInNotification] Using configured pre-stay contact: ${configuredContacts[0].name}`);
                    return configuredContacts[0];
                }
            }
            const ownerId = (recipientIds || []).find((id) => id.startsWith('owner:'));
            if (ownerId) {
                const listing = await this.listingRepo.findOne({ where: { id: reservation.listingMapId } });
                if (listing?.ownerPhone) {
                    return {
                        name: listing.ownerName || 'Owner',
                        contact: listing.ownerPhone,
                        role: 'Owner'
                    };
                }
            }
            const clientId = (recipientIds || []).find((id) => id.startsWith('client:'));
            if (clientId) {
                const client = await this.clientRepo.findOne({ where: { id: clientId.split(':')[1] } });
                if (client?.phone) {
                    return {
                        name: client.preferredName || `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Client',
                        contact: client.phone,
                        role: 'Client'
                    };
                }
            }
            logger.warn(`[CheckInNotification] Configured pre-stay recipients do not include an active contact for listing ${reservation.listingMapId}`);
            return null;
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

    private async getEffectiveSettings(listingId: number) {
        const [settings, globalSettings] = await Promise.all([
            this.settingsRepo.findOne({ where: { listingId } }),
            this.settingsRepo.findOne({ where: { listingId: 0 } })
        ]);
        const resolve = <T>(propertyValue: T | null | undefined, globalValue: T | null | undefined, fallback: T): T =>
            propertyValue !== undefined && propertyValue !== null ? propertyValue : (globalValue !== undefined && globalValue !== null ? globalValue : fallback);
        return {
            preStayEnabled: resolve(settings?.preStayEnabled, globalSettings?.preStayEnabled, true),
            sameDayCombinedEnabled: resolve(settings?.sameDayCombinedEnabled, globalSettings?.sameDayCombinedEnabled, false),
            preStayRecipientIds: resolve(settings?.preStayRecipientIds, globalSettings?.preStayRecipientIds, [] as string[]) || [],
            preStayMessageTemplate: resolve(settings?.preStayMessageTemplate, globalSettings?.preStayMessageTemplate, this.composeCheckInMessageTemplate()),
            ownerName: settings?.ownerName || globalSettings?.ownerName || null,
            ownerEmail: settings?.ownerEmail || globalSettings?.ownerEmail || null,
            ownerPhone: settings?.ownerPhone || globalSettings?.ownerPhone || null,
        };
    }

    private composeCheckInMessageTemplate() {
        return `{propertyName} Check-In Notification

Address: {address}

Reservation #{reservationId}
Guest: {guestName}
Check-In Date: {checkInDate}

{upsellInfo}`;
    }

    private sameDate(a?: Date | string | null, b?: Date | string | null) {
        if (!a || !b) return false;
        return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
    }

    private async hasSameDayCheckout(reservation: ReservationInfoEntity, listing: Listing) {
        const reservations = await this.reservationRepo.find({
            where: {
                listingMapId: listing.id,
                status: In(["new", "accepted", "modified", "ownerStay", "moved"])
            }
        });
        return reservations.some((candidate) => candidate.id !== reservation.id && this.sameDate(candidate.departureDate, reservation.arrivalDate));
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
     * Update notification status in database
     */
    private async updateStatus(
        reservationId: number,
        status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused',
        error?: string,
        contactId?: number,
        message?: string
    ): Promise<void> {
        let audit = await this.preStayAuditRepo.findOne({ where: { reservationId } });
        
        if (!audit) {
            audit = this.preStayAuditRepo.create({
                reservationId,
                doorCode: DoorCodeStatus.UNSET,
                completionStatus: CompletionStatus.NOT_STARTED,
                inventoryCheckStatus: InventoryCheckStatus.UNSET,
                cleanlinessCheck: CleanlinessCheck.UNSET,
                cleanerCheck: CleanerCheck.UNSET,
                cleanerNotified: CleanerNotified.UNSET,
                damageCheck: DamageCheck.UNSET
            });
        }

        audit.notificationStatus = status;
        if (contactId !== undefined) {
             audit.notificationContactId = contactId;
        }
        if (status === 'sent') {
            audit.notificationSentAt = new Date();
        }
        if (message !== undefined) {
            audit.notificationMessage = message;
        }
        if (error !== undefined) {
            audit.notificationError = error;
        } else {
            audit.notificationError = null;
        }

        await this.preStayAuditRepo.save(audit);

        logger.info(`[CheckInNotification] Updated status to '${status}' for reservation ${reservationId}`);
    }

    /**
     * Get reservations expiring in the next 2 days (today and tomorrow)
     */
    async getPendingCheckIns(): Promise<ReservationInfoEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(today.getDate() + 2);

        const reservations = await this.reservationRepo.find({
            where: {
                arrivalDate: Between(today, dayAfterTomorrow),
                status: In(["new", "accepted", "modified", "ownerStay", "moved"]) // valid bookings
            }
        });

        return reservations;
    }

    /**
     * Process automated Check-in notifications for 1 day before at exactly 10 AM local timezone,
     * or ASAP for last-minute bookings.
     */
    async processAutomatedCheckInSMS(): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
        const reservations = await this.getPendingCheckIns();
        
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        let total = reservations.length;

        logger.info(`[CheckInNotification] Found ${total} check-ins for today/tomorrow.`);

        for (const reservation of reservations) {
            try {
                // Skip if already sent
                const existingAudit = await this.preStayAuditRepo.findOne({ where: { reservationId: reservation.id } });
                if (existingAudit?.notificationStatus === 'sent') {
                    skipped++;
                    continue;
                }
                const listing = await this.listingRepo.findOne({
                     where: { id: reservation.listingMapId }
                 });

                if (!listing) {
                    logger.warn(`[CheckInNotification] No listing found for reservation ${reservation.id}. Skipping.`);
                    skipped++;
                    continue;
                }

                const timezone = listing.timeZoneName || 'America/New_York';
                const now = new Date();

                // Evaluate the current hour in local time
                const hourOptions = { timeZone: timezone, hour: 'numeric', hour12: false } as Intl.DateTimeFormatOptions;
                const currentHourStr = new Intl.DateTimeFormat('en-US', hourOptions).format(now);
                const currentHour = parseInt(currentHourStr, 10) % 24;

                // Get local date strings (YYYY-MM-DD)
                const dateOptions = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' } as Intl.DateTimeFormatOptions;
                
                // Using 'en-CA' guarantees standard YYYY-MM-DD string representation
                const currentDateStr = now.toLocaleDateString('en-CA', dateOptions);
                const arrivalDateStr = new Date(reservation.arrivalDate).toLocaleDateString('en-CA', dateOptions);
                
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowDateStr = tomorrow.toLocaleDateString('en-CA', dateOptions);

                let shouldSend = false;

                if (currentDateStr >= arrivalDateStr) {
                    // Check-in is today (or in the past). Send ASAP.
                    shouldSend = true;
                } else if (arrivalDateStr === tomorrowDateStr) {
                    // Check-in is tomorrow. Send if 10 AM or later (catches late bookings).
                    if (currentHour >= 10) {
                        shouldSend = true;
                    }
                }

                if (shouldSend) {
                     logger.info(`[CheckInNotification] Triggering scheduled Check-In SMS for reserve: ${reservation.id} in TZ: ${timezone}`);
                     await this.sendCheckInNotification(reservation.id, true); // True to force logic run instead of manual skip

                     const statusAudit = await this.preStayAuditRepo.findOne({ where: { reservationId: reservation.id } });
                     
                     if (statusAudit?.notificationStatus === 'sent') sent++;
                     else if (statusAudit?.notificationStatus === 'failed') failed++;
                     else if (statusAudit?.notificationStatus === 'skipped') skipped++;
                } else {
                     skipped++; // Didn't match criteria
                }

            } catch (error) {
                logger.error(`[CheckInNotification] Failed automated processing for reservation ${reservation.id}:`, error);
                failed++;
            }
        }

        logger.info(`[CheckInNotification] Automated job finished processing check-ins: ${sent} sent, ${failed} failed, ${skipped} skipped`);
        
        return { sent, failed, skipped, total };
    }
}
