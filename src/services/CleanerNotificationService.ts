import { appDatabase } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ClientEntity } from "../entity/Client";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between, In } from "typeorm";
import { renderTurnoverTemplate, summarizeTemplateErrors } from "../utils/turnoverTemplate.util";

export class CleanerNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private openPhoneService = new OpenPhoneService();

    /**
     * Send checkout notification SMS to cleaner
     */
    async sendCheckoutNotification(reservationId: number): Promise<void> {
        try {
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

            const settings = await this.getEffectiveSettings(listing.id);
            const sameDayCheckIn = await this.getSameDayCheckIn(reservation, listing);
            const useSameDay = !!sameDayCheckIn && settings.sameDayCombinedEnabled && (settings.preStayEnabled || settings.postStayEnabled);
            if (!settings.postStayEnabled && !useSameDay) {
                await this.updateNotificationStatus(reservationId, 'skipped', 'Post-stay turnover messages are disabled for this property');
                return;
            }

            // Determine which cleaner to notify
            const cleaner = await this.getNotificationCleaner(
                reservation,
                postStay,
                useSameDay ? [...settings.preStayRecipientIds, ...settings.postStayRecipientIds] : settings.postStayRecipientIds
            );

            if (!cleaner) {
                const currentPostStay = await this.postStayRepo.findOne({
                    where: { reservationId }
                });

                if (!currentPostStay?.cleanerNotificationError) {
                    await this.updateNotificationStatus(
                        reservationId,
                        'skipped',
                        'No enabled post-stay recipient found for this listing'
                    );
                }
                return;
            }

            // Fetch approved upsells
            const upsells = await this.getApprovedUpsells(reservation);

            // Compose SMS message
            const template = useSameDay ? settings.sameDayCombinedMessageTemplate : settings.postStayMessageTemplate;
            const rendered = renderTurnoverTemplate(template, {
                reservation,
                listing,
                upsells,
                preStayReservation: sameDayCheckIn,
                postStayReservation: reservation,
                ownerName: settings.ownerName,
                ownerEmail: settings.ownerEmail,
                ownerPhone: settings.ownerPhone
            });
            const templateError = summarizeTemplateErrors(rendered);
            if (rendered.blocked) {
                await this.updateNotificationStatus(reservationId, 'skipped', templateError || 'Template variables could not be populated');
                return;
            }
            const message = rendered.message;

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

            // Use dedicated cleaner sender number (required)
            const senderNumber = process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
            if (!senderNumber) {
                await this.updateNotificationStatus(
                    reservationId,
                    'failed',
                    'CLEANER_CHECKOUT_SMS_SENDER_NUMBER not configured, cannot send SMS'
                );
                return;
            }

            // Send SMS via OpenPhone with dedicated sender number
            await this.openPhoneService.sendSMSWithSender(phoneNumber, message, senderNumber);

            // Update status to sent
            await this.updateNotificationStatus(reservationId, 'sent', templateError || undefined, message);

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
        postStay: ReservationDetailPostStayAudit,
        recipientIds?: string[]
    ): Promise<{ id?: number; name: string; contact?: string | null; role?: string | null } | null> {
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

        const contactIds = Array.from(new Set((recipientIds || [])
            .filter((id) => id.startsWith('contact:'))
            .map((id) => Number(id.split(':')[1]))
            .filter((id) => Number.isFinite(id))));
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
                    logger.info(`[CleanerNotification] Using configured post-stay contact: ${configuredContacts[0].name}`);
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
            logger.warn(`[CleanerNotification] Configured post-stay recipients do not include an active contact for listing ${reservation.listingMapId}`);
            return null;
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

    private async getEffectiveSettings(listingId: number) {
        const [settings, globalSettings] = await Promise.all([
            this.settingsRepo.findOne({ where: { listingId } }),
            this.settingsRepo.findOne({ where: { listingId: 0 } })
        ]);
        const resolve = <T>(propertyValue: T | null | undefined, globalValue: T | null | undefined, fallback: T): T =>
            propertyValue !== undefined && propertyValue !== null ? propertyValue : (globalValue !== undefined && globalValue !== null ? globalValue : fallback);
        return {
            preStayEnabled: resolve(settings?.preStayEnabled, globalSettings?.preStayEnabled, true),
            postStayEnabled: resolve(settings?.postStayEnabled, globalSettings?.postStayEnabled, true),
            sameDayCombinedEnabled: resolve(settings?.sameDayCombinedEnabled, globalSettings?.sameDayCombinedEnabled, false),
            preStayRecipientIds: resolve(settings?.preStayRecipientIds, globalSettings?.preStayRecipientIds, [] as string[]) || [],
            postStayRecipientIds: resolve(settings?.postStayRecipientIds, globalSettings?.postStayRecipientIds, [] as string[]) || [],
            postStayMessageTemplate: resolve(settings?.postStayMessageTemplate, globalSettings?.postStayMessageTemplate, this.composeCheckoutMessageTemplate()),
            sameDayCombinedMessageTemplate: resolve(settings?.sameDayCombinedMessageTemplate, globalSettings?.sameDayCombinedMessageTemplate, this.composeSameDayMessageTemplate()),
            ownerName: settings?.ownerName || globalSettings?.ownerName || null,
            ownerEmail: settings?.ownerEmail || globalSettings?.ownerEmail || null,
            ownerPhone: settings?.ownerPhone || globalSettings?.ownerPhone || null,
        };
    }

    private composeCheckoutMessageTemplate() {
        return `{propertyName} Checkout Notification

Address: {address}

Reservation #{reservationId}
Guest: {guestName}
Checkout Date: {checkOutDate}

{upsellInfo}

Please ensure property is cleaned and restocked.`;
    }

    private composeSameDayMessageTemplate() {
        return `{propertyName} Same-Day Turnover Notification

Address: {address}

Checkout Reservation #{postStayReservationId}
Arriving Reservation #{preStayReservationId}

Outgoing Guest: {postStayGuestName}
Incoming Guest: {preStayGuestName}

Checkout Date: {checkOutDate}
Check-In Date: {checkInDate}

{turnoverNotes}`;
    }

    private sameDate(a?: Date | string | null, b?: Date | string | null) {
        if (!a || !b) return false;
        return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
    }

    private async getSameDayCheckIn(reservation: ReservationInfoEntity, listing: Listing) {
        const reservations = await this.reservationRepo.find({
            where: {
                listingMapId: listing.id,
                status: In(["new", "accepted", "modified", "ownerStay", "moved"])
            }
        });
        return reservations.find((candidate) => candidate.id !== reservation.id && this.sameDate(candidate.arrivalDate, reservation.departureDate)) || null;
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
        error?: string,
        message?: string
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
            if (message !== undefined) {
                postStay.cleanerNotificationMessage = message;
            }

            await this.postStayRepo.save(postStay);

            logger.info(`[CleanerNotification] Updated status to '${status}' for reservation ${reservationId}`);

        } catch (err: any) {
            logger.error(`[CleanerNotification] Error updating notification status:`, err.message);
        }
    }
}
