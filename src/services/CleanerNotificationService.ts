import { appDatabase, ensureTurnoverSettingsColumns } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ClientEntity } from "../entity/Client";
import { VendorAssignment } from "../entity/VendorAssignment";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between, In, IsNull } from "typeorm";
import { renderTurnoverTemplate, summarizeTemplateErrors } from "../utils/turnoverTemplate.util";

type ScheduleRelation = "at" | "before" | "after";
type ScheduleAnchor = "check-in" | "check-out";
type NotificationRecipient = { id?: number; name: string; contact?: string | null; role?: string | null };

export class CleanerNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);
    private openPhoneService = new OpenPhoneService();

    private async ensureSettingsSchema() {
        await ensureTurnoverSettingsColumns();
    }

    private normalizeScheduleMode(mode: string | null | undefined, fallbackAnchor: ScheduleAnchor) {
        if (mode === "auto") return `at-${fallbackAnchor}`;
        if (mode === "arrival-day") return "at-check-in";
        if (mode === "checkout-day" || mode === "post-stay") return "at-check-out";
        if (["at-check-in", "before-check-in", "after-check-in", "at-check-out", "before-check-out", "after-check-out"].includes(String(mode))) {
            return String(mode);
        }
        return `at-${fallbackAnchor}`;
    }

    private parseScheduleMode(mode: string | null | undefined, fallbackAnchor: ScheduleAnchor) {
        const normalized = this.normalizeScheduleMode(mode, fallbackAnchor);
        const [relation, anchorSuffix] = normalized.split("-check-");
        return {
            relation: relation as ScheduleRelation,
            anchor: `check-${anchorSuffix}` as ScheduleAnchor
        };
    }

    private getZoneOffsetMinutes(date: Date, timeZone: string): number {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            timeZoneName: "shortOffset",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).formatToParts(date);
        const tz = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
        const match = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tz);
        if (!match) return 0;
        const sign = match[1].startsWith("-") ? -1 : 1;
        const hours = Math.abs(parseInt(match[1], 10));
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        return sign * (hours * 60 + minutes);
    }

    private zoneLocalToUtcDate(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number, timeZone: string) {
        const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
        const offsetMinutes = this.getZoneOffsetMinutes(utcDate, timeZone);
        return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
    }

    private getDateParts(value?: Date | string | null) {
        if (!value) return null;
        if (typeof value === "string") {
            const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
            if (match) {
                return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
            }
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }

    private parseTime(value: string | number | null | undefined, fallbackHour: number) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return { hour: Math.floor(value), minute: Math.round((value % 1) * 60) };
        }
        if (typeof value === "string") {
            const match = /^(\d{1,2})(?::(\d{2}))?/.exec(value);
            if (match) return { hour: Number(match[1]), minute: Number(match[2] || 0) };
        }
        return { hour: fallbackHour, minute: 0 };
    }

    private getScheduledAt(reservation: ReservationInfoEntity, listing: Listing, mode: string | null | undefined, offsetMinutes: number | null | undefined, fallbackAnchor: ScheduleAnchor) {
        const schedule = this.parseScheduleMode(mode, fallbackAnchor);
        const anchorDate = schedule.anchor === "check-in" ? reservation.arrivalDate : reservation.departureDate;
        const dateParts = this.getDateParts(anchorDate);
        if (!dateParts) return null;
        const timeZone = listing.timeZoneName || "America/New_York";
        const time = schedule.anchor === "check-in"
            ? this.parseTime(reservation.checkInTime ?? listing.checkInTimeStart, 15)
            : this.parseTime(reservation.checkOutTime ?? listing.checkOutTime, 11);
        const anchorUtc = this.zoneLocalToUtcDate(dateParts.year, dateParts.month, dateParts.day, time.hour, time.minute, 0, 0, timeZone);
        const offsetMs = Math.max(0, Number(offsetMinutes || 0)) * 60 * 1000;
        if (schedule.relation === "before") return new Date(anchorUtc.getTime() - offsetMs);
        if (schedule.relation === "after") return new Date(anchorUtc.getTime() + offsetMs);
        return anchorUtc;
    }

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
            if (postStay.cleanerNotificationStatus === 'sent') {
                logger.info(`[CleanerNotification] Checkout notification already sent for reservation ${reservationId}`);
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

            const senderNumber = this.getSenderNumberForRecipient(cleaner, listing, settings);
            if (!senderNumber) {
                await this.updateNotificationStatus(
                    reservationId,
                    'failed',
                    'SMS sender number not configured, cannot send SMS'
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
    ): Promise<NotificationRecipient | null> {
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
            const vendorId = (recipientIds || []).find((id) => id.startsWith('vendor:'));
            if (vendorId) {
                const vendorProfileId = Number(vendorId.split(':')[1]);
                if (Number.isFinite(vendorProfileId)) {
                    const assignment = await this.vendorAssignmentRepo.findOne({
                        where: {
                            vendorProfileId,
                            listingId: String(reservation.listingMapId),
                            status: 'active',
                            deletedAt: IsNull()
                        },
                        relations: ['vendorProfile']
                    });
                    if (assignment?.vendorProfile?.contact) {
                        return {
                            id: assignment.vendorProfile.id,
                            name: assignment.vendorProfile.name,
                            contact: assignment.vendorProfile.contact,
                            role: assignment.role || 'Vendor'
                        };
                    }
                }
            }
            const ownerId = (recipientIds || []).find((id) => id.startsWith('owner:'));
            if (ownerId) {
                const client = await this.clientRepo.findOne({ where: { id: ownerId.split(':')[1] } });
                if (client?.phone) {
                    return {
                        name: client.preferredName || `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Owner',
                        contact: client.phone,
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

        const activeVendorAssignments = await this.vendorAssignmentRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                status: 'active',
                deletedAt: IsNull()
            },
            relations: ['vendorProfile'],
            order: { role: 'ASC' as any, id: 'ASC' as any }
        });
        const activeCleaners = activeVendorAssignments
            .filter((assignment) => assignment.vendorProfile?.contact)
            .sort((a, b) => Number(String(b.role || '').toLowerCase() === 'cleaner') - Number(String(a.role || '').toLowerCase() === 'cleaner'));

        if (activeCleaners.length === 0) {
            logger.warn(`[CleanerNotification] No active vendor contacts found for listing ${reservation.listingMapId}`);
            return null;
        }

        const assignment = activeCleaners[0];
        logger.info(`[CleanerNotification] Using active vendor contact: ${assignment.vendorProfile.name}`);
        return {
            id: assignment.vendorProfile.id,
            name: assignment.vendorProfile.name,
            contact: assignment.vendorProfile.contact,
            role: assignment.role || 'Vendor'
        };
    }

    private getListingPortfolioGroup(listing: Listing) {
        const tags = String(listing.tags || "").toLowerCase();
        if (tags.includes("group1")) return "group1";
        if (tags.includes("group2")) return "group2";
        return null;
    }

    private getSenderNumberForRecipient(
        contact: NotificationRecipient,
        listing: Listing,
        settings: Awaited<ReturnType<CleanerNotificationService["getEffectiveSettings"]>>
    ) {
        const role = String(contact.role || "").toLowerCase();
        if (role === "owner" || role === "client") {
            return settings.ownerSenderNumber || process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        }
        const group = this.getListingPortfolioGroup(listing);
        if (group === "group1") {
            return settings.cleanerSenderNumberGroup1 || settings.cleanerSenderNumber || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        }
        if (group === "group2") {
            return settings.cleanerSenderNumberGroup2 || settings.cleanerSenderNumber || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
        }
        return settings.cleanerSenderNumber || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
    }

    private async getEffectiveSettings(listingId: number) {
        await this.ensureSettingsSchema();
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
            preStayScheduleMode: resolve(settings?.preStayScheduleMode, globalSettings?.preStayScheduleMode, "at-check-in"),
            preStayOffsetMinutes: resolve(settings?.preStayOffsetMinutes, globalSettings?.preStayOffsetMinutes, 0),
            postStayScheduleMode: resolve(settings?.postStayScheduleMode, globalSettings?.postStayScheduleMode, "at-check-out"),
            postStayOffsetMinutes: resolve(settings?.postStayOffsetMinutes, globalSettings?.postStayOffsetMinutes, 0),
            cleanerSenderNumber: resolve(settings?.cleanerSenderNumber, globalSettings?.cleanerSenderNumber, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null),
            cleanerSenderNumberGroup1: resolve(settings?.cleanerSenderNumberGroup1, globalSettings?.cleanerSenderNumberGroup1, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || null),
            cleanerSenderNumberGroup2: resolve(settings?.cleanerSenderNumberGroup2, globalSettings?.cleanerSenderNumberGroup2, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || null),
            ownerSenderNumber: resolve(settings?.ownerSenderNumber, globalSettings?.ownerSenderNumber, process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || null),
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

    private getAutomationScheduledAt(
        checkoutReservation: ReservationInfoEntity,
        listing: Listing,
        settings: Awaited<ReturnType<CleanerNotificationService["getEffectiveSettings"]>>,
        sameDayCheckIn: ReservationInfoEntity | null
    ) {
        const postStayScheduledAt = this.getScheduledAt(
            checkoutReservation,
            listing,
            settings.postStayScheduleMode,
            settings.postStayOffsetMinutes,
            "check-out"
        );
        if (!sameDayCheckIn || !settings.sameDayCombinedEnabled) return postStayScheduledAt;
        const preStayScheduledAt = this.getScheduledAt(
            sameDayCheckIn,
            listing,
            settings.preStayScheduleMode,
            settings.preStayOffsetMinutes,
            "check-in"
        );
        if (!preStayScheduledAt) return postStayScheduledAt;
        if (!postStayScheduledAt) return preStayScheduledAt;
        return preStayScheduledAt < postStayScheduledAt ? preStayScheduledAt : postStayScheduledAt;
    }

    async getPendingCheckouts(): Promise<ReservationInfoEntity[]> {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 14);

        const end = new Date();
        end.setHours(23, 59, 59, 999);
        end.setDate(end.getDate() + 30);

        return this.reservationRepo.find({
            where: {
                departureDate: Between(start, end),
                status: In(["new", "accepted", "modified", "ownerStay", "moved"])
            }
        });
    }

    async processAutomatedCheckoutSMS(): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
        const reservations = await this.getPendingCheckouts();
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const total = reservations.length;

        logger.info(`[CleanerNotification] Found ${total} candidate checkouts for automated post-stay scheduling.`);

        for (const reservation of reservations) {
            try {
                const existingAudit = await this.postStayRepo.findOne({ where: { reservationId: reservation.id } });
                if (existingAudit?.cleanerNotificationStatus === "sent") {
                    skipped++;
                    continue;
                }

                const listing = await this.listingRepo.findOne({ where: { id: reservation.listingMapId } });
                if (!listing) {
                    logger.warn(`[CleanerNotification] No listing found for reservation ${reservation.id}. Skipping.`);
                    skipped++;
                    continue;
                }

                const settings = await this.getEffectiveSettings(listing.id);
                const sameDayCheckIn = await this.getSameDayCheckIn(reservation, listing);
                const scheduledAt = this.getAutomationScheduledAt(reservation, listing, settings, sameDayCheckIn);
                if (!scheduledAt || new Date() < scheduledAt) {
                    skipped++;
                    continue;
                }

                logger.info(`[CleanerNotification] Triggering scheduled checkout SMS for reservation ${reservation.id}. Scheduled at ${scheduledAt.toISOString()}`);
                await this.sendCheckoutNotification(reservation.id);
                const statusAudit = await this.postStayRepo.findOne({ where: { reservationId: reservation.id } });
                if (statusAudit?.cleanerNotificationStatus === "sent") sent++;
                else if (statusAudit?.cleanerNotificationStatus === "failed") failed++;
                else skipped++;
            } catch (error) {
                logger.error(`[CleanerNotification] Failed automated processing for reservation ${reservation.id}:`, error);
                failed++;
            }
        }

        logger.info(`[CleanerNotification] Automated job finished processing checkouts: ${sent} sent, ${failed} failed, ${skipped} skipped`);
        return { sent, failed, skipped, total };
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
