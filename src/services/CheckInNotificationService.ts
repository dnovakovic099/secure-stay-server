import { appDatabase, ensureTurnoverSettingsColumns } from "../utils/database.util";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Listing } from "../entity/Listing";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { VendorAssignment } from "../entity/VendorAssignment";
import { OpenPhoneService } from "./OpenPhoneService";
import logger from "../utils/logger.utils";
import { Between, In, IsNull } from "typeorm";
import { renderTurnoverTemplate, summarizeTemplateErrors } from "../utils/turnoverTemplate.util";

import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { DoorCodeStatus, CompletionStatus, InventoryCheckStatus, CleanlinessCheck, CleanerCheck, CleanerNotified, DamageCheck } from "../entity/ReservationDetailPreStayAudit";

type ScheduleRelation = "at" | "before" | "after";
type ScheduleAnchor = "check-in" | "check-out";
type NotificationRecipient = { id?: number; name: string; contact?: string | null; role?: string | null };


export class CheckInNotificationService {
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);
    private listingRepo = appDatabase.getRepository(Listing);
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private clientPropertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private vendorAssignmentRepo = appDatabase.getRepository(VendorAssignment);
    private preStayAuditRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
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

            const senderNumber = this.getSenderNumberForRecipient(contact, listing, settings);
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
    ): Promise<NotificationRecipient | null> {
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
            logger.warn(`[CheckInNotification] Configured pre-stay recipients do not include an active contact for listing ${reservation.listingMapId}`);
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
        const activeVendors = activeVendorAssignments
            .filter((assignment) => assignment.vendorProfile?.contact)
            .sort((a, b) => Number(String(b.role || '').toLowerCase() === 'cleaner') - Number(String(a.role || '').toLowerCase() === 'cleaner'));

        if (activeVendors.length === 0) {
            logger.warn(`[CheckInNotification] No active vendor contacts found for listing ${reservation.listingMapId}`);
            return null;
        }

        const assignment = activeVendors[0];
        logger.info(`[CheckInNotification] Using active vendor contact: ${assignment.vendorProfile.name}`);
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
        settings: Awaited<ReturnType<CheckInNotificationService["getEffectiveSettings"]>>
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
        return settings.cleanerSenderNumber || process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER;
    }

    private normalizeDefaultRecipientType(value: any): "cleaner" | "owner" | "custom" {
        const normalized = String(value || "").trim().toLowerCase();
        if (normalized === "owner") return "owner";
        if (normalized === "custom") return "custom";
        return "cleaner";
    }

    private async getOwnerRecipientIds(listingId: number) {
        const property = await this.clientPropertyRepo.findOne({
            where: [
                { listingId: String(listingId) },
                { hostifyListingId: String(listingId) }
            ],
            relations: ["client"]
        });
        return property?.client?.phone ? [`owner:${property.client.id}`] : [];
    }

    private async resolveRecipientIdsForMode(listingId: number, mode: any, explicitIds: string[] = []) {
        const type = this.normalizeDefaultRecipientType(mode);
        if (type === "custom") return explicitIds || [];
        if (type === "owner") return this.getOwnerRecipientIds(listingId);
        return [];
    }

    private async getEffectiveSettings(listingId: number) {
        await this.ensureSettingsSchema();
        const [settings, globalSettings] = await Promise.all([
            this.settingsRepo.findOne({ where: { listingId } }),
            this.settingsRepo.findOne({ where: { listingId: 0 } })
        ]);
        const resolve = <T>(propertyValue: T | null | undefined, globalValue: T | null | undefined, fallback: T): T =>
            propertyValue !== undefined && propertyValue !== null ? propertyValue : (globalValue !== undefined && globalValue !== null ? globalValue : fallback);
        const resolveEnabled = (
            propertyValue: boolean | null | undefined,
            _overrideValue: boolean | null | undefined,
            globalValue: boolean | null | undefined,
            fallback: boolean
        ) => {
            // Global OFF is a hard kill — bug fix for unintended live SMS sends.
            if (globalValue === false) return false;
            if (propertyValue === false) return false;
            return globalValue !== undefined && globalValue !== null ? Boolean(globalValue) : fallback;
        };
        const preStayDefaultRecipientType = resolve(settings?.preStayDefaultRecipientType, globalSettings?.preStayDefaultRecipientType, "cleaner");
        const explicitPreStayRecipientIds = resolve(settings?.preStayRecipientIds, globalSettings?.preStayRecipientIds, [] as string[]) || [];
        return {
            preStayEnabled: resolveEnabled(settings?.preStayEnabled, settings?.preStayEnabledOverride, globalSettings?.preStayEnabled, true),
            sameDayCombinedEnabled: resolveEnabled(settings?.sameDayCombinedEnabled, settings?.sameDayCombinedEnabledOverride, globalSettings?.sameDayCombinedEnabled, false),
            preStayRecipientIds: await this.resolveRecipientIdsForMode(listingId, preStayDefaultRecipientType, explicitPreStayRecipientIds),
            preStayDefaultRecipientType,
            preStayMessageTemplate: resolve(settings?.preStayMessageTemplate, globalSettings?.preStayMessageTemplate, this.composeCheckInMessageTemplate()),
            preStayScheduleMode: resolve(settings?.preStayScheduleMode, globalSettings?.preStayScheduleMode, "at-check-in"),
            preStayOffsetMinutes: resolve(settings?.preStayOffsetMinutes, globalSettings?.preStayOffsetMinutes, 0),
            cleanerSenderNumber: resolve(settings?.cleanerSenderNumber, globalSettings?.cleanerSenderNumber, process.env.CHECKIN_SMS_SENDER_NUMBER || process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER || null),
            cleanerSenderNumberGroup1: resolve(settings?.cleanerSenderNumberGroup1, globalSettings?.cleanerSenderNumberGroup1, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP1 || null),
            cleanerSenderNumberGroup2: resolve(settings?.cleanerSenderNumberGroup2, globalSettings?.cleanerSenderNumberGroup2, process.env.CLEANER_CHECKOUT_SMS_SENDER_NUMBER_GROUP2 || null),
            ownerSenderNumber: resolve(settings?.ownerSenderNumber, globalSettings?.ownerSenderNumber, process.env.OWNER_TURNOVER_SMS_SENDER_NUMBER || null),
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

    async getPendingCheckIns(): Promise<ReservationInfoEntity[]> {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 14);

        const end = new Date();
        end.setHours(23, 59, 59, 999);
        end.setDate(end.getDate() + 30);

        const reservations = await this.reservationRepo.find({
            where: {
                arrivalDate: Between(start, end),
                status: In(["new", "accepted", "modified", "ownerStay", "moved"]) // valid bookings
            }
        });

        return reservations;
    }

    async processAutomatedCheckInSMS(): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
        const reservations = await this.getPendingCheckIns();
        
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        let total = reservations.length;

        logger.info(`[CheckInNotification] Found ${total} candidate check-ins for automated pre-stay scheduling.`);

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

                const settings = await this.getEffectiveSettings(listing.id);
                const scheduledAt = this.getScheduledAt(reservation, listing, settings.preStayScheduleMode, settings.preStayOffsetMinutes, "check-in");
                const shouldSend = !!scheduledAt && new Date() >= scheduledAt;

                if (shouldSend) {
                     logger.info(`[CheckInNotification] Triggering scheduled Check-In SMS for reservation ${reservation.id}. Scheduled at ${scheduledAt?.toISOString()}`);
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
