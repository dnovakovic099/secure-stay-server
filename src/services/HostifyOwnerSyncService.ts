import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { Listing } from "../entity/Listing";
import logger from "../utils/logger.utils";
import axios from "axios";

const HOSTIFY_API_KEY = process.env.HOSTIFY_API_KEY || 'aOGSVrcPGOvvSsGD4idPKvxKaD0HGaAW';
const HOSTIFY_BASE_URL = 'https://api-rms.hostify.com';

interface HostifyUser {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    phone: number;
    roles: string;
}

interface HostifyListing {
    id: number;
    name: string;
    nickname: string;
    street: string;
    city: string;
    state: string;
    country: string;
    zipcode: number;
    users: HostifyUser[];
}

interface OwnerWithProperties {
    hostifyId: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    properties: {
        hostifyListingId: number;
        nickname: string;
        address: string;
        city: string;
        state: string;
    }[];
}

export class HostifyOwnerSyncService {
    private clientRepo = appDatabase.getRepository(ClientEntity);
    private clientPropertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private listingRepo = appDatabase.getRepository(Listing);

    /**
     * Fetch all listings from Hostify
     */
    private async fetchHostifyListings(): Promise<HostifyListing[]> {
        try {
            const allListings: HostifyListing[] = [];
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                const response = await axios.get(`${HOSTIFY_BASE_URL}/listings`, {
                    headers: { 'X-API-Key': HOSTIFY_API_KEY },
                    params: { page, limit: 100 }
                });

                const data = response.data;
                const listings = data.listings || [];
                allListings.push(...listings);

                // Check if there are more pages
                hasMore = data.next_page && listings.length === 100;
                page++;
            }

            logger.info(`[HostifyOwnerSync] Fetched ${allListings.length} listings from Hostify`);
            return allListings;
        } catch (error: any) {
            logger.error(`[HostifyOwnerSync] Error fetching listings:`, error.message);
            throw error;
        }
    }

    /**
     * Extract owners from listings
     */
    private extractOwners(listings: HostifyListing[]): OwnerWithProperties[] {
        const ownerMap = new Map<number, OwnerWithProperties>();

        for (const listing of listings) {
            for (const user of listing.users || []) {
                // Check if user is an owner (role contains "Owner")
                if (!user.roles?.includes('Owner')) continue;

                const ownerId = user.id;
                
                if (!ownerMap.has(ownerId)) {
                    ownerMap.set(ownerId, {
                        hostifyId: ownerId,
                        firstName: user.first_name || '',
                        lastName: user.last_name || '',
                        email: user.username || '',
                        phone: user.phone ? String(user.phone) : '',
                        properties: []
                    });
                }

                ownerMap.get(ownerId)!.properties.push({
                    hostifyListingId: listing.id,
                    nickname: listing.nickname || listing.name,
                    address: listing.street || '',
                    city: listing.city || '',
                    state: listing.state || ''
                });
            }
        }

        return Array.from(ownerMap.values());
    }

    /**
     * Sync owners from Hostify to SecureStay Clients table
     */
    async syncOwners(createdBy: string = 'system'): Promise<{ created: number; updated: number; skipped: number }> {
        try {
            logger.info(`[HostifyOwnerSync] Starting owner sync...`);

            // Fetch listings from Hostify
            const listings = await this.fetchHostifyListings();
            
            // Extract owners
            const owners = this.extractOwners(listings);
            logger.info(`[HostifyOwnerSync] Found ${owners.length} owners`);

            let created = 0;
            let updated = 0;
            let skipped = 0;

            for (const owner of owners) {
                try {
                    // Check if client already exists (by hostify source, or email
                    // when the owner actually has one — an empty email must never
                    // match another client's empty email).
                    const where: any[] = [{ source: `hostify:${owner.hostifyId}` }];
                    if (owner.email && owner.email.trim()) where.push({ email: owner.email });
                    let existingClient = await this.clientRepo.findOne({
                        where,
                        relations: ['properties']
                    });

                    if (existingClient) {
                        // Update existing client
                        existingClient.firstName = owner.firstName || existingClient.firstName;
                        existingClient.lastName = owner.lastName || existingClient.lastName;
                        existingClient.phone = owner.phone || existingClient.phone;
                        existingClient.source = `hostify:${owner.hostifyId}`;
                        existingClient.updatedBy = createdBy;
                        
                        await this.clientRepo.save(existingClient);
                        
                        // Update properties
                        await this.syncClientProperties(existingClient, owner.properties);
                        
                        updated++;
                        logger.info(`[HostifyOwnerSync] Updated client: ${owner.email}`);
                    } else {
                        // Create new client
                        const newClient = this.clientRepo.create({
                            firstName: owner.firstName,
                            lastName: owner.lastName,
                            preferredName: null,
                            email: owner.email,
                            phone: owner.phone,
                            status: 'Active',
                            serviceType: 'Full Service',
                            source: `hostify:${owner.hostifyId}`,
                            createdBy
                        });

                        const savedClient = await this.clientRepo.save(newClient);
                        
                        // Add properties
                        await this.syncClientProperties(savedClient, owner.properties);
                        
                        created++;
                        logger.info(`[HostifyOwnerSync] Created client: ${owner.email}`);
                    }
                } catch (err: any) {
                    logger.error(`[HostifyOwnerSync] Error syncing owner ${owner.email}:`, err.message);
                    skipped++;
                }
            }

            logger.info(`[HostifyOwnerSync] Sync complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
            return { created, updated, skipped };

        } catch (error: any) {
            logger.error(`[HostifyOwnerSync] Sync failed:`, error.message);
            throw error;
        }
    }

    /**
     * Sync properties for a client
     */
    private async syncClientProperties(
        client: ClientEntity,
        properties: OwnerWithProperties['properties']
    ): Promise<void> {
        for (const prop of properties) {
            // Find the listing in our database
            const listing = await this.listingRepo.findOne({
                where: { id: prop.hostifyListingId }
            });

            if (!listing) {
                logger.warn(`[HostifyOwnerSync] Listing ${prop.hostifyListingId} not found in database`);
                continue;
            }

            // Check if property association already exists
            const existingProp = await this.clientPropertyRepo.findOne({
                where: {
                    client: { id: client.id },
                    listingId: String(listing.id)
                }
            });

            if (!existingProp) {
                // Create new property association
                const newProp = this.clientPropertyRepo.create({
                    client,
                    listingId: String(listing.id),
                    address: prop.address || listing.address,
                    createdBy: 'system'
                });

                await this.clientPropertyRepo.save(newProp);
                logger.info(`[HostifyOwnerSync] Added property ${prop.nickname} to client ${client.email}`);
            }
        }
    }

    /**
     * Get all owners from Hostify (for display/preview)
     */
    async getHostifyOwners(): Promise<OwnerWithProperties[]> {
        const listings = await this.fetchHostifyListings();
        return this.extractOwners(listings);
    }
}
