import { appDatabase } from "../utils/database.util";
import { TurnoverSettings } from "../entity/TurnoverSettings";
import { ReservationDetailPreStayAudit } from "../entity/ReservationDetailPreStayAudit";
import { ReservationDetailPostStayAudit } from "../entity/ReservationDetailPostStayAudit";
import { Listing } from "../entity/Listing";
import { Contact } from "../entity/Contact";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
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
    propertyType: 'own' | 'arb' | 'pm';
    listingTimezone?: string;
    listingTags?: string;
    
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
    checkInTime?: string;
    checkOutTime?: string;
    reservationCode?: string;
    
    notificationType: 'pre-stay' | 'post-stay';
    contactId?: number;
    contactName?: string;
    contactPhone?: string;
    
    status: 'pending' | 'sent' | 'failed' | 'skipped' | 'paused';
    sentAt?: string;
    error?: string;
    
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
    notificationType?: string;
    status?: string;
    propertyType?: string;
    fromDate?: string;
    toDate?: string;
    listingId?: number;
    date?: 'today' | 'tomorrow';
}

export class TurnoverService {
    private settingsRepo = appDatabase.getRepository(TurnoverSettings);
    private preStayRepo = appDatabase.getRepository(ReservationDetailPreStayAudit);
    private postStayRepo = appDatabase.getRepository(ReservationDetailPostStayAudit);
    private listingRepo = appDatabase.getRepository(Listing);
    private contactRepo = appDatabase.getRepository(Contact);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    /**
     * Get turnover notifications (combined pre-stay and post-stay)
     */
    async getNotifications(filters: TurnoverFilters = {}): Promise<TurnoverNotification[]> {
        try {
            // Calculate date range
            let fromDate: Date, toDate: Date;
            const now = new Date();
            
            if (filters.date === 'today') {
                fromDate = new Date(now.setHours(0, 0, 0, 0));
                toDate = new Date(now.setHours(23, 59, 59, 999));
            } else if (filters.date === 'tomorrow') {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                fromDate = new Date(tomorrow.setHours(0, 0, 0, 0));
                toDate = new Date(tomorrow.setHours(23, 59, 59, 999));
            } else if (filters.fromDate && filters.toDate) {
                fromDate = new Date(filters.fromDate);
                toDate = new Date(filters.toDate);
                toDate.setHours(23, 59, 59, 999);
            } else {
                // Default: today and tomorrow
                fromDate = new Date(now.setHours(0, 0, 0, 0));
                const dayAfterTomorrow = new Date();
                dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
                toDate = dayAfterTomorrow;
            }

            const notifications: TurnoverNotification[] = [];
            const includePreStay = !filters.notificationType || filters.notificationType.includes('pre-stay');
            const includePostStay = !filters.notificationType || filters.notificationType.includes('post-stay');

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
                    const propertyType = this.getPropertyType(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact if assigned
                    let contact = null;
                    if (settings?.preStayContactId) {
                        contact = await this.contactRepo.findOne({ where: { id: settings.preStayContactId } });
                    }

                    const notification: TurnoverNotification = {
                        id: res.id,
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.internalListingName || listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        listingTimezone: listing.timezone || 'America/Chicago',
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: res.arrivalDate ? new Date(res.arrivalDate).toISOString() : '',
                        checkOutDate: res.departureDate ? new Date(res.departureDate).toISOString() : '',
                        checkInTime: listing.checkInTimeStart || '15:00',
                        checkOutTime: listing.checkOutTime || '11:00',
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'pre-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        
                        status: preStayAudit?.cleanerNotified === 'yes' ? 'sent' : 'pending',
                        sentAt: undefined,
                        error: undefined,
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: preStayAudit?.approvedUpsells ? JSON.parse(preStayAudit.approvedUpsells) : [],
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
                    const propertyType = this.getPropertyType(listing);
                    if (filters.propertyType && !filters.propertyType.includes(propertyType)) continue;

                    // Get settings for this listing
                    const settings = await this.settingsRepo.findOne({ where: { listingId: listing.id } });
                    
                    // Get contact
                    let contact = null;
                    if (postStayAudit?.cleanerNotificationContactId) {
                        contact = await this.contactRepo.findOne({ where: { id: postStayAudit.cleanerNotificationContactId } });
                    } else if (settings?.postStayContactId) {
                        contact = await this.contactRepo.findOne({ where: { id: settings.postStayContactId } });
                    }

                    const notification: TurnoverNotification = {
                        id: res.id + 1000000, // Offset to avoid ID collision
                        reservationId: res.id,
                        listingId: listing.id,
                        listingName: listing.internalListingName || listing.name,
                        listingNickname: listing.internalListingName || listing.name,
                        address: listing.address || '',
                        propertyType,
                        listingTimezone: listing.timezone || 'America/Chicago',
                        listingTags: listing.tags || '',
                        
                        guestName: res.guestName || 'Unknown Guest',
                        checkInDate: res.arrivalDate ? new Date(res.arrivalDate).toISOString() : '',
                        checkOutDate: res.departureDate ? new Date(res.departureDate).toISOString() : '',
                        checkInTime: listing.checkInTimeStart || '15:00',
                        checkOutTime: listing.checkOutTime || '11:00',
                        reservationCode: res.reservationId || '',
                        
                        notificationType: 'post-stay',
                        contactId: contact?.id,
                        contactName: contact?.name,
                        contactPhone: contact?.contact, // Contact entity uses 'contact' field for phone
                        
                        status: postStayAudit?.cleanerNotificationStatus as any || 'pending',
                        sentAt: postStayAudit?.cleanerNotificationSentAt?.toISOString(),
                        error: postStayAudit?.cleanerNotificationError || undefined,
                        
                        ownerName: settings?.ownerName,
                        ownerEmail: settings?.ownerEmail,
                        ownerPhone: settings?.ownerPhone,
                        
                        upsells: postStayAudit?.approvedUpsells ? JSON.parse(postStayAudit.approvedUpsells) : [],
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
     * Get property type from listing tags (primary) or nickname (fallback)
     * Tags: "Own" = own, "Arb" = arb, "pm"/"PM" = pm
     */
    private getPropertyType(listing: Listing): 'own' | 'arb' | 'pm' {
        // First check tags
        const tags = (listing.tags || '').toLowerCase();
        if (tags.includes('own')) return 'own';
        if (tags.includes('arb')) return 'arb';
        if (tags.includes('pm')) return 'pm';
        
        // Fallback to nickname
        const nickname = (listing.internalListingName || listing.name || '').toLowerCase();
        if (nickname.includes('own')) return 'own';
        if (nickname.includes('arb')) return 'arb';
        
        return 'pm';
    }

    /**
     * Get turnover settings for all listings
     */
    async getSettings(filters?: { propertyType?: string; search?: string }): Promise<any[]> {
        try {
            const listings = await this.listingRepo.find();

            const results = [];
            
            for (const listing of listings) {
                const propertyType = this.getPropertyType(listing);
                
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
                
                if (settings?.preStayContactId) {
                    preStayContact = await this.contactRepo.findOne({ where: { id: settings.preStayContactId } });
                }
                if (settings?.postStayContactId) {
                    postStayContact = await this.contactRepo.findOne({ where: { id: settings.postStayContactId } });
                }

                results.push({
                    id: listing.id,
                    listingId: listing.id,
                    listingName: listing.internalListingName || listing.name,
                    listingNickname: listing.internalListingName || listing.name,
                    propertyType,
                    address: listing.address,
                    
                    preStayContactId: settings?.preStayContactId,
                    preStayContactName: preStayContact?.name,
                    preStayEnabled: settings?.preStayEnabled ?? true,
                    
                    postStayContactId: settings?.postStayContactId,
                    postStayContactName: postStayContact?.name,
                    postStayEnabled: settings?.postStayEnabled ?? true,
                    
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
