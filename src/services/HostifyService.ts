import { appDatabase } from "../utils/database.util";
import { Hostify, HostifyUser as HFClientUser, HostifyUserListing } from "../client/Hostify";
import { HostifyUser } from "../entity/HostifyUser";
import logger from "../utils/logger.utils";

interface HFListing {
    id: number;
    name: string;
    nickname?: string;
    address?: string;
}

export interface FormattedHostifyUser {
    id: number;
    hostifyId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    timezone?: string;
    language?: string;
    avatar?: string;
    permissions?: string[];
    lastLogin: Date | null;
    createdAt: Date;
    updatedAt: Date;
    listings?: HFListing[];
}

export class HostifyService {
    private hostifyClient: Hostify;

    constructor() {
        this.hostifyClient = new Hostify();
    }

    /**
     * Fetch users from local DB and map their listings
     */
    async getUsers(): Promise<FormattedHostifyUser[]> {
        const repo = appDatabase.getRepository(HostifyUser);
        const usersRecords = await repo.find();

        // Find all unique listing IDs referenced by users
        const allListingIds = new Set<number>();
        usersRecords.forEach(user => {
            if (user.listing_ids) {
                try {
                    const parsedIds = typeof user.listing_ids === 'string' ? JSON.parse(user.listing_ids) : user.listing_ids;
                    if (Array.isArray(parsedIds)) {
                        parsedIds.forEach(id => allListingIds.add(id));
                    }
                } catch (e) {
                     logger.error(`[HostifyService] Error parsing listing_ids for user ${user.id}:`, e);
                }
            }
        });

        // Fetch referenced listings from listing_info
        const listingsMap = new Map<number, HFListing>();
        if (allListingIds.size > 0) {
            const listingIdsArray = Array.from(allListingIds);
            const listingRecords: any[] = await appDatabase.query(
                `SELECT id, name, internalListingName as nickname, address FROM listing_info WHERE id IN (?)`,
                [listingIdsArray]
            );

            listingRecords.forEach(listing => {
                listingsMap.set(Number(listing.id), {
                    id: Number(listing.id),
                    name: listing.name,
                    nickname: listing.nickname,
                    address: listing.address
                });
            });
        }

        // Map database records back to the expected HFUser format
        const formattedUsers: FormattedHostifyUser[] = usersRecords.map(user => {
            let userListings: HFListing[] = [];
            if (user.listing_ids) {
                try {
                    const parsedIds = typeof user.listing_ids === 'string' ? JSON.parse(user.listing_ids) : user.listing_ids;
                    if (Array.isArray(parsedIds)) {
                        userListings = parsedIds
                            .map((id: number) => listingsMap.get(id))
                            .filter((listing: HFListing | undefined) => listing !== undefined) as HFListing[];
                    }
                } catch (e) { }
            }

            return {
                id: user.id,
                hostifyId: user.hostifyId,
                firstName: user.first_name || '',
                lastName: user.last_name || '',
                email: user.username || '',
                phone: user.phone || '',
                role: user.roles || 'unknown',
                status: user.status || 'active',
                timezone: user.timezone,
                language: user.language,
                avatar: user.avatar,
                permissions: [],
                lastLogin: user.last_login_at,
                createdAt: user.created_at,
                updatedAt: user.updated_at,
                listings: userListings
            };
        });

        return formattedUsers;
    }

    /**
     * Sync users from Hostify API to Database
     */
    async syncUsers(apiKey: string): Promise<any[]> {
        logger.info("[HostifyService] Syncing users from Hostify...");

        const hostifyUsers = await this.hostifyClient.getUsers(apiKey);
        let syncedCount = 0;

        const repo = appDatabase.getRepository(HostifyUser);

        for (const user of hostifyUsers) {
            const hostifyId = String(user.id);
            const listingIds = user.listings?.map((l: HostifyUserListing) => l.id) || [];
            
            // Try to find if user exists
            let existingUser = await repo.findOne({ where: { hostifyId } });
            
            if (existingUser) {
                // Update
                existingUser.username = user.email || ''; 
                existingUser.first_name = user.first_name || '';
                existingUser.last_name = user.last_name || '';
                existingUser.phone = user.phone || '';
                existingUser.is_active = user.status === 'active';
                existingUser.roles = user.role || '';
                existingUser.status = user.status || 'active';
                existingUser.timezone = user.timezone || '';
                existingUser.language = user.language || '';
                existingUser.avatar = user.avatar || '';
                // existingUser.last_login_at = user.last_login_at ? new Date(user.last_login_at) : null;
                existingUser.listing_ids = listingIds;
                
                await repo.save(existingUser);
            } else {
                // Insert
                const newUser = repo.create({
                    hostifyId,
                    username: user.email || '',
                    first_name: user.first_name || '',
                    last_name: user.last_name || '',
                    phone: user.phone || '',
                    is_active: user.status === 'active',
                    roles: user.role || '',
                    status: user.status || 'active',
                    timezone: user.timezone || '',
                    language: user.language || '',
                    avatar: user.avatar || '',
                    // last_login_at: user.last_login_at ? new Date(user.last_login_at) : null,
                    listing_ids: listingIds,
                });
                await repo.save(newUser);
            }
            
            syncedCount++;
        }

        logger.info(`[HostifyService] Synced ${syncedCount} users from Hostify to Database`);

        // Fetch resulting data to return aligned format
        const usersRecords = await repo.find();
        
        const transformedUsers = usersRecords.map(user => ({
            id: user.id,
            hostifyId: user.hostifyId,
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            email: user.username || '',
            phone: user.phone || '',
            role: user.roles || 'Standard Listing Owner',
            status: user.status || 'active',
            listings: user.listing_ids ? (typeof user.listing_ids === 'string' ? JSON.parse(user.listing_ids) : user.listing_ids) : []
        }));

        return transformedUsers;
    }
}

export default new HostifyService();
