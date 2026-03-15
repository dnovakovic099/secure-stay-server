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

    private async getEarlyCheckInUpsells(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            const bookingId = reservation.hostawayReservationId || reservation.reservationId;
            if (!bookingId) return [];
            const upsells = await this.upsellRepo.find({
                where: { booking_id: bookingId }
            });
            return upsells.filter(u =>
                u.type?.toLowerCase().includes('early') ||
                u.type?.toLowerCase().includes('check-in') ||
                u.type?.toLowerCase().includes('checkin')
            );
        } catch (error: any) {
            logger.error(`[TurnoverService] Error fetching upsells:`, error.message);
            return [];
        }
    }

    private async getApprovedUpsells(reservation: ReservationInfoEntity): Promise<UpsellOrder[]> {
        try {
            const bookingId = reservation.hostawayReservationId || reservation.reservationId;
            if (!bookingId) return [];
            const postStay = await this.postStayRepo.findOne({ where: { reservationId: reservation.id } });
            if (!postStay?.approvedUpsells) return [];
            const approvedUpsellIds = JSON.parse(postStay.approvedUpsells || '[]');
            if (!Array.isArray(approvedUpsellIds) || approvedUpsellIds.length === 0) return [];
            return await this.upsellRepo.find({ where: { id: In(approvedUpsellIds) } });
        } catch (error: any) {
            logger.error(`[TurnoverService] Error fetching approved upsells:`, error.message);
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
            // Calculate date range from scopes or filters
            let fromDate: Date;
            let toDate: Date;
            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(now);
            todayEnd.setHours(23, 59, 59, 999);
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            const tomorrowEnd = new Date(tomorrowStart);
            tomorrowEnd.setHours(23, 59, 59, 999);

            const scopes = filters.scopes || [];
            const hasScopes = scopes.length > 0;
            const includesToday = scopes.includes('today');
            const includesTomorrow = scopes.includes('tomorrow');
            const globalSettings = await this.settingsRepo.findOne({ where: { listingId: 0 } });

            if (includesToday || includesTomorrow) {
                if (includesToday && includesTomorrow) {
                    fromDate = todayStart;
                    toDate = tomorrowEnd;
                } else if (includesTomorrow) {
                    fromDate = tomorrowStart;
                    toDate = tomorrowEnd;
                } else {
                    fromDate = todayStart;
                    toDate = todayEnd;
                }
            } else if (filters.fromDate && filters.toDate) {
                fromDate = new Date(filters.fromDate);
                toDate = new Date(filters.toDate);
                toDate.setHours(23, 59, 59, 999);
            } else if (filters.date === 'tomorrow') {
                fromDate = tomorrowStart;
                toDate = tomorrowEnd;
            } else {
                // Default: today only
                fromDate = todayStart;
                toDate = todayEnd;
            }

            const notifications: TurnoverNotification[] = [];
            const includePreStay = hasScopes
                ? (scopes.includes('pre-stay') || includesToday || includesTomorrow)
                : (!filters.notificationType || filters.notificationType.includes('pre-stay'));
            const includePostStay = hasScopes
                ? (scopes.includes('post-stay') || includesToday || includesTomorrow)
                : (!filters.notificationType || filters.notificationType.includes('post-stay'));

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
                        arrivalDate: Between(fromDate, toDate),
                        status: In(['accepted', 'moved', 'extended'])
                    }
                });

                for (const res of preStayReservations) {
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
                    
                    // Get contact if assigned
                    const contact = await this.resolvePreStayContact(res, preStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getEarlyCheckInUpsells(res);
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
                        checkInDate: res.arrivalDate ? new Date(res.arrivalDate).toISOString() : '',
                        checkOutDate: res.departureDate ? new Date(res.departureDate).toISOString() : '',
                        checkInTime: res.checkInTime ?? (listing.checkInTimeStart ?? 15),
                        checkOutTime: res.checkOutTime ?? (listing.checkOutTime ?? 11),
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'pre-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        messagePreview,
                        
                        status: preStayAudit?.cleanerNotified === 'yes' ? 'sent' : 'pending',
                        sentAt: undefined,
                        error: undefined,
                        
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

                    notifications.push(notification);
                }
            }

            // Get reservations with check-outs in date range (post-stay)
            if (includePostStay) {
                const postStayReservations = await this.reservationRepo.find({
                    where: {
                        ...reservationWhere,
                        departureDate: Between(fromDate, toDate),
                        status: In(['accepted', 'moved', 'extended'])
                    }
                });

                for (const res of postStayReservations) {
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
                    
                    // Get contact
                    const contact = await this.resolvePostStayContact(res, postStayAudit, settings, globalSettings);
                    const listingTimezone = this.resolveTimeZone(listing);
                    const listingTimezoneLabel = this.getReadableTimeZone(listingTimezone);
                    const upsells = await this.getApprovedUpsells(res);
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
                        checkInDate: res.arrivalDate ? new Date(res.arrivalDate).toISOString() : '',
                        checkOutDate: res.departureDate ? new Date(res.departureDate).toISOString() : '',
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

                    notifications.push(notification);
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

            // Sort by date
            notifications.sort((a, b) => {
                const dateA = a.notificationType === 'pre-stay' ? a.checkInDate : a.checkOutDate;
                const dateB = b.notificationType === 'pre-stay' ? b.checkInDate : b.checkOutDate;
                return new Date(dateA).getTime() - new Date(dateB).getTime();
            });

            return notifications;
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
        notifications.forEach((n) => {
            const dateKey = (n.notificationType === 'post-stay' ? n.checkOutDate : n.checkInDate)?.slice(0, 10);
            if (!dateKey) return;
            if (!dateCounts[dateKey]) {
                dateCounts[dateKey] = { preStay: 0, postStay: 0, total: 0 };
            }
            if (n.notificationType === 'pre-stay') {
                dateCounts[dateKey].preStay += 1;
            } else {
                dateCounts[dateKey].postStay += 1;
            }
            dateCounts[dateKey].total += 1;
        });

        const todayKey = new Date().toISOString().slice(0, 10);
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowKey = tomorrowDate.toISOString().slice(0, 10);

        return {
            preStay: notifications.filter((n) => n.notificationType === 'pre-stay').length,
            postStay: notifications.filter((n) => n.notificationType === 'post-stay').length,
            today: dateCounts[todayKey]?.total || 0,
            tomorrow: dateCounts[tomorrowKey]?.total || 0,
            dateCounts: Object.entries(dateCounts)
                .map(([date, counts]) => ({ date, ...counts }))
                .sort((a, b) => a.date.localeCompare(b.date)),
        };
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
