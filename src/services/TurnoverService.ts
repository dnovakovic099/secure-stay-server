import { appDatabase } from "../utils/database.util";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { Listing } from "../entity/Listing";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";
import logger from "../utils/logger.utils";
import { Between, In, Like, MoreThanOrEqual, LessThanOrEqual, Raw } from "typeorm";
import axios from "axios";
import { Hostify } from "../client/Hostify";
import { format } from "date-fns";
import { CleanerNotified } from "../entity/ReservationDetailPreStayAudit";

const HOSTIFY_API_KEY = process.env.HOSTIFY_API_KEY || 'aOGSVrcPGOvvSsGD4idPKvxKaD0HGaAW';
const HOSTIFY_BASE_URL = 'https://api-rms.hostify.com';

interface TurnoverNotification {
    id: number;
    reservationId: number;
    listingId: number;
    listingName: string;
    listingNickname: string;
    address: string;
    propertyType: 'Own' | 'Arb' | 'PM';
    listingTimezone?: string;
    listingTimezoneLabel?: string;
    listingTags?: string;
    
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
    checkInTime?: string | number;
    checkOutTime?: string | number;
    reservationCode?: string;
    
    notificationType: 'pre-stay' | 'post-stay';
    contactId?: number;
    contactName?: string;
    contactPhone?: string;
    messagePreview?: string;
    
    status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused';
    sentAt?: string;
    error?: string;
    isSameDayTurnover?: boolean;
    preStayAuditStatus?: string | null;
    postStayAuditStatus?: string | null;
    
    // Owner info
    ownerName?: string;
    ownerEmail?: string;
    ownerPhone?: string;
    
    upsells?: any[];
    createdAt: string;
    updatedAt: string;
}

interface TurnoverFilters {
    search?: string;
    notificationType?: string[];
    status?: string[];
    propertyType?: string[];
    fromDate?: string;
    toDate?: string;
    listingId?: number;
    date?: 'today' | 'tomorrow';
    dateField?: 'checkIn' | 'checkOut';
    scopes?: string[];
}

export class TurnoverService {
    private getZoneDateParts(date: Date, timeZone: string) {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).formatToParts(date);
        const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
        return {
            year: Number(get("year")),
            month: Number(get("month")),
            day: Number(get("day")),
            hour: Number(get("hour")),
            minute: Number(get("minute")),
            second: Number(get("second"))
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

    private zoneLocalToUtcDate(
        year: number,
        month: number,
        day: number,
        hour: number,
        minute: number,
        second: number,
        millisecond: number,
        timeZone: string
    ) {
        const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
        const offsetMinutes = this.getZoneOffsetMinutes(utcDate, timeZone);
        return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);
    }

    private getEasternDayRanges() {
        const timeZone = "America/New_York";
        const now = new Date();
        const todayParts = this.getZoneDateParts(now, timeZone);
        // Derive tomorrow by incrementing the Eastern calendar day to avoid DST
        // boundary errors (adding 24 h can land on the same calendar day during
        // the spring-forward transition).
        const tomorrowUtc = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + 1, 12, 0, 0));
        const tomorrowParts = this.getZoneDateParts(tomorrowUtc, timeZone);

        const todayStart = this.zoneLocalToUtcDate(todayParts.year, todayParts.month, todayParts.day, 0, 0, 0, 0, timeZone);
        const todayEnd = this.zoneLocalToUtcDate(todayParts.year, todayParts.month, todayParts.day, 23, 59, 59, 999, timeZone);
        const tomorrowStart = this.zoneLocalToUtcDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 0, 0, 0, 0, timeZone);
        const tomorrowEnd = this.zoneLocalToUtcDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 23, 59, 59, 999, timeZone);

        const todayKey = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-${String(todayParts.day).padStart(2, "0")}`;
        const tomorrowKey = `${tomorrowParts.year}-${String(tomorrowParts.month).padStart(2, "0")}-${String(tomorrowParts.day).padStart(2, "0")}`;

        return { todayStart, todayEnd, tomorrowStart, tomorrowEnd, todayKey, tomorrowKey };
    }
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private preStayRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private listingRepo = appDatabase.getRepository(Listing);
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private upsellRepo = appDatabase.getRepository(UpsellOrder);

    private normalizeTimeZoneCandidate(candidate?: string) {
        if (!candidate) return "";
        const normalized = candidate.trim();
        const lower = normalized.toLowerCase();
        const aliases: Record<string, string> = {
            "eastern time": "America/New_York",
            "central time": "America/Chicago",
            "mountain time": "America/Denver",
            "pacific time": "America/Los_Angeles",
            "us/eastern": "America/New_York",
            "us/central": "America/Chicago",
            "us/mountain": "America/Denver",
            "us/pacific": "America/Los_Angeles",
        };
        if (aliases[lower]) return aliases[lower];
        return normalized;
    }

    private isValidTimeZone(timeZone?: string) {
        if (!timeZone) return false;
        try {
            Intl.DateTimeFormat("en-US", { timeZone });
            return true;
        } catch {
            return false;
        }
    }

    private mapStateToTimeZone(stateCode?: string) {
        if (!stateCode) return "America/New_York";
        const state = stateCode.toUpperCase();
        const pacific = ["WA", "OR", "CA", "NV"];
        const mountain = ["ID", "MT", "WY", "UT", "CO", "NM", "AZ"];
        const central = [
            "ND",
            "SD",
            "NE",
            "KS",
            "OK",
            "TX",
            "MN",
            "IA",
            "MO",
            "AR",
            "LA",
            "WI",
            "IL",
            "MS",
            "AL",
        ];
        if (pacific.includes(state)) return "America/Los_Angeles";
        if (mountain.includes(state)) return "America/Denver";
        if (central.includes(state)) return "America/Chicago";
        return "America/New_York";
    }

    private formatDateOnly(value?: Date | string | null) {
        if (!value) return "";
        if (typeof value === "string") {
            return value.length >= 10 ? value.slice(0, 10) : value;
        }
        if (!(value instanceof Date)) return "";
        const time = value.getTime();
        if (Number.isNaN(time)) return "";
        // Use local date parts to avoid UTC off-by-one when the server timezone
        // differs from UTC (e.g. a Date representing midnight local time would
        // shift to the previous day if serialised via toISOString/UTC).
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    private resolveTimeZone(listing: any) {
        const candidateRaw =
            listing?.timeZoneName ||
            listing?.timezone ||
            listing?.time_zone ||
            listing?.listingTimeZoneName ||
            "";
        const candidate = this.normalizeTimeZoneCandidate(candidateRaw);
        if (this.isValidTimeZone(candidate)) return candidate;
        if (listing?.state) return this.mapStateToTimeZone(listing.state);
        if (listing?.address) {
            const match = listing.address.match(/\b([A-Z]{2})\b/);
            if (match?.[1]) return this.mapStateToTimeZone(match[1]);
        }
        return "";
    }

    private getReadableTimeZone(timeZone?: string) {
        const labels: Record<string, string> = {
            "America/New_York": "Eastern Time",
            "America/Chicago": "Central Time",
            "America/Denver": "Mountain Time",
            "America/Phoenix": "Mountain Time",
            "America/Los_Angeles": "Pacific Time",
            "America/Anchorage": "Alaska Time",
            "Pacific/Honolulu": "Hawaii Time",
        };
        if (!timeZone) return "";
        return labels[timeZone] || timeZone;
    }

    private getPropertyTypeLabel(listing: Listing): 'Own' | 'Arb' | 'PM' {
        const tags = (listing.tags || '').toLowerCase();
        if (tags.includes('own')) return 'Own';
        if (tags.includes('arb')) return 'Arb';
        return 'PM';
    }

    private async resolvePreStayContact(
        reservation: ReservationInfoEntity,
        preStayAudit: ReservationDetailPreStayAudit | null,
        settings: TurnoverSettings | null,
        globalSettings: TurnoverSettings | null
    ): Promise<Contact | null> {
        const overrideId = preStayAudit?.notificationContactId;
        if (overrideId) {
            const overrideContact = await this.contactRepo.findOne({ where: { id: overrideId } });
            if (overrideContact) return overrideContact;
        }

        const settingsContactId = settings?.preStayContactId || globalSettings?.preStayContactId;
        if (settingsContactId) {
            const contact = await this.contactRepo.findOne({ where: { id: settingsContactId } });
            if (contact) return contact;
        }

        const activeContacts = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
        return activeContacts[0] || null;
    }

    private async resolvePostStayContact(
        reservation: ReservationInfoEntity,
        postStayAudit: ReservationDetailPostStayAudit | null,
        settings: TurnoverSettings | null,
        globalSettings: TurnoverSettings | null
    ): Promise<Contact | null> {
        const overrideId = postStayAudit?.cleanerNotificationContactId;
        if (overrideId) {
            const overrideContact = await this.contactRepo.findOne({ where: { id: overrideId } });
            if (overrideContact) return overrideContact;
        }

        const settingsContactId = settings?.postStayContactId || globalSettings?.postStayContactId;
        if (settingsContactId) {
            const contact = await this.contactRepo.findOne({ where: { id: settingsContactId } });
            if (contact) return contact;
        }

        const activeContacts = await this.contactRepo.find({
            where: {
                listingId: String(reservation.listingMapId),
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
        return activeContacts[0] || null;
    }

    // Fetch all approved upsells for a reservation, matching how the reservations
    // page looks them up: by the DB reservation id (as a string) with status "Approved".
    private async getApprovedUpsellsForReservation(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            return await this.upsellRepo.find({
                where: { booking_id: String(reservation.id), status: 'Approved' }
            });
        } catch (error: any) {
            logger.error(`[TurnoverService] Error fetching upsells:`, error.message);
            return [];
        }
    }

    private buildCheckInMessage(reservation: ReservationInfoEntity, listing: Listing, upsells: UpsellOrder[]): string {
        const lines: string[] = [];
        lines.push(`${listing.internalListingName || listing.name} Check-In Notification`);
        lines.push('');
        lines.push(`Address: ${listing.address || ''}`);
        lines.push('');
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName || 'Unknown Guest'}`);
        lines.push(`Check-In Date: ${reservation.arrivalDate ? new Date(reservation.arrivalDate).toLocaleDateString() : '-'}`);
        if (upsells.length > 0) {
            lines.push('');
            lines.push('Upsells:');
            upsells.forEach((upsell) => lines.push(`- ${upsell.type}`));
        }
        return lines.join('\n');
    }

    private buildCheckoutMessage(reservation: ReservationInfoEntity, listing: Listing, upsells: UpsellOrder[]): string {
        const lines: string[] = [];
        lines.push(`${listing.internalListingName || listing.name} Check-Out Notification`);
        lines.push('');
        lines.push(`Address: ${listing.address || ''}`);
        lines.push('');
        lines.push(`Reservation #${reservation.id}`);
        lines.push(`Guest: ${reservation.guestName || 'Unknown Guest'}`);
        lines.push(`Check-Out Date: ${reservation.departureDate ? new Date(reservation.departureDate).toLocaleDateString() : '-'}`);
        if (upsells.length > 0) {
            lines.push('');
            lines.push('Upsells:');
            upsells.forEach((upsell) => lines.push(`- ${upsell.type}`));
        }
        return lines.join('\n');
    }

    /**
     * Get turnover notifications (combined pre-stay and post-stay)
     */
    async getNotifications(filters: TurnoverFilters = {}): Promise<TurnoverNotification[]> {
        try {
            // Calculate date range from scopes or filters (Eastern date keys)
            let fromDateStr: string;
            let toDateStr: string;
            const { todayKey, tomorrowKey } = this.getEasternDayRanges();

            const scopes = filters.scopes || [];
            const hasScopes = scopes.length > 0;
            const includesToday = scopes.includes('today');
            const includesTomorrow = scopes.includes('tomorrow');
            const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });

            if (includesToday || includesTomorrow) {
                if (includesToday && includesTomorrow) {
                    fromDateStr = todayKey;
                    toDateStr = tomorrowKey;
                } else if (includesTomorrow) {
                    fromDateStr = tomorrowKey;
                    toDateStr = tomorrowKey;
                } else {
                    fromDateStr = todayKey;
                    toDateStr = todayKey;
                }
            } else if (filters.fromDate && filters.toDate) {
                fromDateStr = filters.fromDate;
                toDateStr = filters.toDate;
            } else if (filters.date === 'tomorrow') {
                fromDateStr = tomorrowKey;
                toDateStr = tomorrowKey;
            } else {
                // Default: today only
                fromDateStr = todayKey;
                toDateStr = todayKey;
            }

            const notifications: TurnoverNotification[] = [];
            const seenKeys = new Set<string>();
            const includePreStay = hasScopes
                ? (scopes.includes('pre-stay') || includesToday || includesTomorrow)
                : (!filters.notificationType || filters.notificationType.includes('pre-stay'));
            const includePostStay = hasScopes
                ? (scopes.includes('post-stay') || includesToday || includesTomorrow)
                : (!filters.notificationType || filters.notificationType.includes('post-stay'));
            const includesSameDay = hasScopes && scopes.includes('sameday');
            const useDateFieldFilter = !includesToday && !includesTomorrow && !!(filters.fromDate && filters.toDate && filters.dateField);
            const dateField = filters.dateField === 'checkOut' ? 'checkOut' : 'checkIn';

            // Build reservation query
            const reservationWhere: any = {};
            
            if (filters.listingId) {
                reservationWhere.listingMapId = filters.listingId;
            }

            // Get reservations with check-ins in date range (pre-stay)
            if (includePreStay) {
                const preStayReservations = await this.reservationRepo.find({
                    where: {
                        ...reservationWhere,
                        ...(useDateFieldFilter && dateField === 'checkOut'
                            ? { departureDate: Between(fromDateStr, toDateStr) }
                            : { arrivalDate: Between(fromDateStr, toDateStr) }),
                        status: In(["new", "accepted", "modified", "ownerStay", "moved"])
                    }
                });

                for (const res of preStayReservations) {
                    const preStayAudit = await this.preStayRepo.findOne({
                        where: { reservationId: res.id }
                    });
                    const postStayAudit = await this.postStayRepo.findOne({
                        where: { reservationId: res.id }
                    });

                    const listing = await this.listingRepo.findOne({ where: { id: res.listingMapId } });
                    if (!listing) continue;

                    // Apply property type filter
                    const propertyType = this.getPropertyTypeLabel(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact if assigned
                    const contact = await this.resolvePreStayContact(res, preStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getApprovedUpsellsForReservation(res);
                    const messagePreview = this.buildCheckInMessage(res, listing, upsells);

                    const notification: TurnoverNotification = {
                        id: res.id,
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        listingTimezone: listingTimezone || 'America/Chicago',
                        listingTimezoneLabel,
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: this.formatDateOnly(res.arrivalDate),
                        checkOutDate: this.formatDateOnly(res.departureDate),
                        checkInTime: res.checkInTime ?? (listing.checkInTimeStart ?? 15),
                        checkOutTime: res.checkOutTime ?? (listing.checkOutTime ?? 11),
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'pre-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        messagePreview,
                        
                        status: (preStayAudit?.notificationStatus as any) || (preStayAudit?.cleanerNotified === 'yes' ? 'sent' : 'pending'),
                        sentAt: preStayAudit?.notificationSentAt ? preStayAudit.notificationSentAt.toISOString() : undefined,
                        error: undefined,
                        preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
                        postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
                        createdAt: res.reservationDate || '',
                        updatedAt: preStayAudit?.updatedAt?.toISOString() || ''
                    };

                    // Apply search filter
                    if (filters.search) {
                        const searchLower = filters.search.toLowerCase();
                        if (!notification.listingName.toLowerCase().includes(searchLower) &&
                            !notification.guestName.toLowerCase().includes(searchLower) &&
                            !notification.address.toLowerCase().includes(searchLower)) {
                            continue;
                        }
                    }

                    // Apply status filter
                    if (filters.status && !filters.status.includes(notification.status)) continue;

                    const dedupeKey = `${notification.reservationId}-pre-${notification.checkInDate}`;
                    if (!seenKeys.has(dedupeKey)) {
                        seenKeys.add(dedupeKey);
                        notifications.push(notification);
                    }
                }
            }

            // Get reservations with check-outs in date range (post-stay)
            if (includePostStay) {
                const postStayReservations = await this.reservationRepo.find({
                    where: {
                        ...reservationWhere,
                        ...(useDateFieldFilter && dateField === 'checkIn'
                            ? { arrivalDate: Between(fromDateStr, toDateStr) }
                            : { departureDate: Between(fromDateStr, toDateStr) }),
                        status: In(["new", "accepted", "modified", "ownerStay", "moved"])
                    }
                });

                for (const res of postStayReservations) {
                    const postStayAudit = await this.postStayRepo.findOne({
                        where: { reservationId: res.id }
                    });
                    const preStayAudit = await this.preStayRepo.findOne({
                        where: { reservationId: res.id }
                    });

                    const listing = await this.listingRepo.findOne({ where: { id: res.listingMapId } });
                    if (!listing) continue;

                    // Apply property type filter
                    const propertyType = this.getPropertyTypeLabel(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact
                    const contact = await this.resolvePostStayContact(res, postStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getApprovedUpsellsForReservation(res);
                    const messagePreview = this.buildCheckoutMessage(res, listing, upsells);

                    const notification: TurnoverNotification = {
                        id: res.id + 1000000, // Offset to avoid ID collision
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        listingTimezone: listingTimezone || 'America/Chicago',
                        listingTimezoneLabel,
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: this.formatDateOnly(res.arrivalDate),
                        checkOutDate: this.formatDateOnly(res.departureDate),
                        checkInTime: res.checkInTime ?? (listing.checkInTimeStart ?? 15),
                        checkOutTime: res.checkOutTime ?? (listing.checkOutTime ?? 11),
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'post-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        messagePreview,
                        
                        status: postStayAudit?.cleanerNotificationStatus as any || 'pending',
                        sentAt: postStayAudit?.cleanerNotificationSentAt?.toISOString(),
                        error: postStayAudit?.cleanerNotificationError || undefined,
                        preStayAuditStatus: preStayAudit?.completionStatus || 'Not Started',
                        postStayAuditStatus: postStayAudit?.completionStatus || 'Not Started',
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: upsells.map((u) => ({ id: u.id, type: u.type, approved: true })),
                        createdAt: res.reservationDate || '',
                        updatedAt: postStayAudit?.updatedAt?.toISOString() || ''
                    };

                    // Apply search filter
                    if (filters.search) {
                        const searchLower = filters.search.toLowerCase();
                        if (!notification.listingName.toLowerCase().includes(searchLower) &&
                            !notification.guestName.toLowerCase().includes(searchLower) &&
                            !notification.address.toLowerCase().includes(searchLower)) {
                            continue;
                        }
                    }

                    // Apply status filter
                    if (filters.status && !filters.status.includes(notification.status)) continue;

                    const dedupeKey = `${notification.reservationId}-post-${notification.checkOutDate}`;
                    if (!seenKeys.has(dedupeKey)) {
                        seenKeys.add(dedupeKey);
                        notifications.push(notification);
                    }
                }
            }

            // Same-day turnover detection across full filtered dataset
            const checkInMap = new Map<string, Set<string>>();
            const checkOutMap = new Map<string, Set<string>>();

            notifications.forEach((n) => {
                const checkInKey = n.checkInDate ? n.checkInDate.slice(0, 10) : "";
                const checkOutKey = n.checkOutDate ? n.checkOutDate.slice(0, 10) : "";
                const listingKey = String(n.listingId);
                if (checkInKey) {
                    const set = checkInMap.get(listingKey) || new Set<string>();
                    set.add(checkInKey);
                    checkInMap.set(listingKey, set);
                }
                if (checkOutKey) {
                    const set = checkOutMap.get(listingKey) || new Set<string>();
                    set.add(checkOutKey);
                    checkOutMap.set(listingKey, set);
                }
            });

            notifications.forEach((n) => {
                const listingKey = String(n.listingId);
                if (n.notificationType === 'pre-stay') {
                    const dateKey = n.checkInDate ? n.checkInDate.slice(0, 10) : "";
                    n.isSameDayTurnover = dateKey ? (checkOutMap.get(listingKey)?.has(dateKey) || false) : false;
                } else {
                    const dateKey = n.checkOutDate ? n.checkOutDate.slice(0, 10) : "";
                    n.isSameDayTurnover = dateKey ? (checkInMap.get(listingKey)?.has(dateKey) || false) : false;
                }
            });

            const scopedNotifications = includesSameDay
                ? notifications.filter((n) => n.isSameDayTurnover)
                : notifications;

            // Sort by date
            scopedNotifications.sort((a, b) => {
                const dateA = a.notificationType === 'pre-stay' ? a.checkInDate : a.checkOutDate;
                const dateB = b.notificationType === 'pre-stay' ? b.checkInDate : b.checkOutDate;
                return new Date(dateA).getTime() - new Date(dateB).getTime();
            });

            // Final de-dupe: one reservation + one type + one date = one row
            const unique = new Map<string, TurnoverNotification>();
            scopedNotifications.forEach((n) => {
                const dateKey = n.notificationType === 'pre-stay' ? n.checkInDate : n.checkOutDate;
                const key = `${n.reservationId}-${n.notificationType}-${dateKey || ''}`;
                if (!unique.has(key)) {
                    unique.set(key, n);
                }
            });

            return Array.from(unique.values());
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting notifications:`, error.message);
            throw error;
        }
    }

    /**
     * Get summary counts for turnovers with filters applied
     */
    async getNotificationSummary(filters: TurnoverFilters = {}) {
        const notifications = await this.getNotifications(filters);

        const dateCounts: Record<string, { preStay: number; postStay: number; total: number; }> = {};
        const checkInByListingDate = new Map<string, Set<string>>();
        const checkOutByListingDate = new Map<string, Set<string>>();
        notifications.forEach((n) => {
            const dateKey = (n.notificationType === 'post-stay' ? n.checkOutDate : n.checkInDate)?.slice(0, 10);
            if (!dateKey) return;
            if (!dateCounts[dateKey]) {
                dateCounts[dateKey] = { preStay: 0, postStay: 0, total: 0 };
            }
            const listingKey = String(n.listingId);
            if (n.notificationType === 'pre-stay') {
                dateCounts[dateKey].preStay += 1;
                const set = checkInByListingDate.get(listingKey) || new Set<string>();
                set.add(dateKey);
                checkInByListingDate.set(listingKey, set);
            } else {
                dateCounts[dateKey].postStay += 1;
                const set = checkOutByListingDate.get(listingKey) || new Set<string>();
                set.add(dateKey);
                checkOutByListingDate.set(listingKey, set);
            }
            dateCounts[dateKey].total += 1;
        });

        const { todayKey, tomorrowKey } = this.getEasternDayRanges();

        // Count 1 per property per date where BOTH a check-in AND check-out exist (same-day turnover)
        const sameDayCounts: Record<string, number> = {};
        checkInByListingDate.forEach((checkInDates, listingId) => {
            const checkOutDates = checkOutByListingDate.get(listingId);
            if (!checkOutDates) return;
            checkInDates.forEach((dateKey) => {
                if (checkOutDates.has(dateKey)) {
                    sameDayCounts[dateKey] = (sameDayCounts[dateKey] || 0) + 1;
                }
            });
        });

        return {
            preStay: notifications.filter((n) => n.notificationType === 'pre-stay').length,
            postStay: notifications.filter((n) => n.notificationType === 'post-stay').length,
            today: dateCounts[todayKey]?.total || 0,
            tomorrow: dateCounts[tomorrowKey]?.total || 0,
            todaySummary: {
                total_turnovers: (dateCounts[todayKey]?.preStay || 0) + (dateCounts[todayKey]?.postStay || 0),
                prestay_total: dateCounts[todayKey]?.preStay || 0,
                poststay_total: dateCounts[todayKey]?.postStay || 0,
                prestay_same_day: sameDayCounts[todayKey] || 0,
                poststay_same_day: sameDayCounts[todayKey] || 0,
                prestay_standard: Math.max((dateCounts[todayKey]?.preStay || 0) - (sameDayCounts[todayKey] || 0), 0),
                poststay_standard: Math.max((dateCounts[todayKey]?.postStay || 0) - (sameDayCounts[todayKey] || 0), 0),
                same_day_turnovers: sameDayCounts[todayKey] || 0,
                date: todayKey
            },
            tomorrowSummary: {
                total_turnovers: (dateCounts[tomorrowKey]?.preStay || 0) + (dateCounts[tomorrowKey]?.postStay || 0),
                prestay_total: dateCounts[tomorrowKey]?.preStay || 0,
                poststay_total: dateCounts[tomorrowKey]?.postStay || 0,
                prestay_same_day: sameDayCounts[tomorrowKey] || 0,
                poststay_same_day: sameDayCounts[tomorrowKey] || 0,
                prestay_standard: Math.max((dateCounts[tomorrowKey]?.preStay || 0) - (sameDayCounts[tomorrowKey] || 0), 0),
                poststay_standard: Math.max((dateCounts[tomorrowKey]?.postStay || 0) - (sameDayCounts[tomorrowKey] || 0), 0),
                same_day_turnovers: sameDayCounts[tomorrowKey] || 0,
                date: tomorrowKey
            },
            dateCounts: Object.entries(dateCounts)
                .map(([date, counts]) => ({ date, ...counts }))
                .sort((a, b) => a.date.localeCompare(b.date)),
        };
    }

    /**
     * Update notification status for a reservation/type
     */
    async updateNotificationStatus(
        reservationId: number,
        type: 'pre-stay' | 'post-stay',
        action: 'send' | 'pause' | 'resume' | 'skip',
        userId?: string
    ) {
        const now = new Date();
        if (type === 'pre-stay') {
            let audit = await this.preStayRepo.findOne({ where: { reservationId } });
            if (!audit) {
                audit = this.preStayRepo.create({ reservationId });
            }
            const statusMap: Record<string, string> = {
                send: 'sent',
                pause: 'paused',
                resume: 'pending',
                skip: 'skipped'
            };
            const status = statusMap[action] || 'pending';
            audit.notificationStatus = status;
            if (action === 'send') {
                audit.notificationSentAt = now;
                audit.cleanerNotified = CleanerNotified.YES;
            }
            if (userId) {
                audit.updatedBy = userId;
            }
            return this.preStayRepo.save(audit);
        }

        let audit = await this.postStayRepo.findOne({ where: { reservationId } });
        if (!audit) {
            audit = this.postStayRepo.create({ reservationId });
        }
        const statusMap: Record<string, string> = {
            send: 'sent',
            pause: 'skipped',
            resume: 'pending',
            skip: 'skipped'
        };
        const status = statusMap[action] || 'pending';
        audit.cleanerNotificationStatus = status;
        if (action === 'send') {
            audit.cleanerNotificationSentAt = now;
        }
        if (userId) {
            audit.updatedBy = userId;
        }
        return this.postStayRepo.save(audit);
    }

    /**
     * Get turnover settings for all listings
     */
    async getSettings(filters?: { propertyType?: string[]; search?: string }): Promise<any[]> {
        try {
            const listings = await this.listingRepo.find();
            const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });

            const results = [];
            
            for (const listing of listings) {
                const propertyType = this.getPropertyTypeLabel(listing);
                
                // Apply property type filter
                if (filters?.propertyType && !filters.propertyType.includes(propertyType)) continue;

                // Apply search filter
                if (filters?.search) {
                    const searchLower = filters.search.toLowerCase();
                    const listingName = (listing.internalListingName || listing.name || '').toLowerCase();
                    const address = (listing.address || '').toLowerCase();
                    if (!listingName.includes(searchLower) && !address.includes(searchLower)) continue;
                }

                let settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                
                // Get contacts
                let preStayContact = null;
                let postStayContact = null;
                
                const preStayContactId = settings?.preStayContactId || globalSettings?.preStayContactId;
                const postStayContactId = settings?.postStayContactId || globalSettings?.postStayContactId;

                if (preStayContactId) {
                    preStayContact = await this.contactRepo.findOne({ where: { id: preStayContactId } });
                }
                if (postStayContactId) {
                    postStayContact = await this.contactRepo.findOne({ where: { id: postStayContactId } });
                }

                results.push({
                    id: listing.id,
                    listingId: listing.id,
                    listingName: listing.name,
                    listingNickname: listing.internalListingName || listing.name,
                    propertyType,
                    address: listing.address,
                    
                    preStayContactId: preStayContactId,
                    preStayContactName: preStayContact?.name,
                    preStayEnabled: settings?.preStayEnabled ?? true,
                    preStayMessageTemplate: settings?.preStayMessageTemplate || globalSettings?.preStayMessageTemplate,
                    
                    postStayContactId: postStayContactId,
                    postStayContactName: postStayContact?.name,
                    postStayEnabled: settings?.postStayEnabled ?? true,
                    postStayMessageTemplate: settings?.postStayMessageTemplate || globalSettings?.postStayMessageTemplate,
                    
                    ownerName: settings?.ownerName,
                    ownerEmail: settings?.ownerEmail,
                    ownerPhone: settings?.ownerPhone,
                    
                    updatedAt: settings?.updatedAt,
                    updatedBy: settings?.updatedBy
                });
            }

            return results;
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting settings:`, error.message);
            throw error;
        }
    }

    /**
     * Get global turnover settings (listingId = 0)
     */
    async getGlobalSettings(): Promise<TurnoverSettings> {
        let settings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        if (!settings) {
            settings = this.settingsRepo.create({
                listingId: 0,
                preStayEnabled: true,
                postStayEnabled: true,
            } as TurnoverSettings);
            settings = await this.settingsRepo.save(settings);
        }
        return settings;
    }

    /**
     * Update global turnover settings (listingId = 0)
     */
    async updateGlobalSettings(data: Partial<TurnoverSettings>, userId?: string): Promise<TurnoverSettings> {
        let settings = await this.settingsRepo.findOne({ where: { listingId: 0 } });
        if (!settings) {
            settings = this.settingsRepo.create({ listingId: 0 } as TurnoverSettings);
        }
        Object.assign(settings, { ...data, updatedBy: userId });
        return await this.settingsRepo.save(settings);
    }

    /**
     * Get global contacts list (active cleaners)
     */
    async getGlobalContacts(): Promise<Contact[]> {
        const contacts = await this.contactRepo.find({
            where: {
                role: 'Cleaner',
                status: 'active',
                deletedAt: null as any
            }
        });
        return contacts;
    }

    /**
     * Update turnover settings for a listing
     */
    async updateSettings(listingId: number, data: Partial<TurnoverSettings>, userId?: string): Promise<TurnoverSettings> {
        try {
            let settings = await this.settingsRepo.findOne({ where: { listingId } });
            
            if (!settings) {
                settings = this.settingsRepo.create({ listingId });
            }

            Object.assign(settings, {
                ...data,
                updatedBy: userId
            });

            return await this.settingsRepo.save(settings);
        } catch (error: any) {
            logger.error(`[TurnoverService] Error updating settings:`, error.message);
            throw error;
        }
    }

    /**
     * Get contacts for a listing (cleaners)
     */
    async getContactsForListing(listingId: number): Promise<Contact[]> {
        try {
            const contacts = await this.contactRepo.find({
                where: {
                    listingId: listingId.toString(),
                    status: In(['active', 'active-backup'])
                }
            });

            // Filter to cleaners
            return contacts.filter(c => 
                c.role?.toLowerCase().includes('cleaner') || 
                c.role?.toLowerCase().includes('housekeeper')
            );
        } catch (error: any) {
            logger.error(`[TurnoverService] Error getting contacts:`, error.message);
            throw error;
        }
    }

    /**
     * Sync owner data from Hostify to settings
     */
    async syncOwnersFromHostify(): Promise<{ synced: number }> {
        try {
            logger.info(`[TurnoverService] Syncing owners from Hostify...`);
            
            // Fetch all listings from Hostify using the central API client
            const hostifyClient = new Hostify();
            const hostifyListings = await hostifyClient.getListings(HOSTIFY_API_KEY);

            let synced = 0;

            for (const hostifyListing of hostifyListings) {
                // Find owner in users array
                const owner = hostifyListing.users?.find((u: any) => u.roles?.includes('Owner'));
                if (!owner) continue;

                // Find matching listing in our database
                const listing = await this.listingRepo.findOne({ where: { id: hostifyListing.id } });
                if (!listing) continue;

                // Update or create settings
                let settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                if (!settings) {
                    settings = this.settingsRepo.create({ listingId: listing.id });
                }

                settings.ownerName = `${owner.first_name || ''} ${owner.last_name || ''}`.trim();
                settings.ownerEmail = owner.username || '';
                settings.ownerPhone = owner.phone ? String(owner.phone) : '';

                await this.settingsRepo.save(settings);
                synced++;
            }

            logger.info(`[TurnoverService] Synced ${synced} owners from Hostify`);
            return { synced };
        } catch (error: any) {
            logger.error(`[TurnoverService] Error syncing owners:`, error.message);
            throw error;
        }
    }
}
