import { appDatabase } from "../utils/database.util";
import { HostawayUser } from "../entity/HostawayUser";
import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";

export class HostawayUserService {
    private hostawayUserRepo = appDatabase.getRepository(HostawayUser);
    private hostAwayClient = new HostAwayClient();

    async syncHostawayUser(): Promise<void> {
        try {
            const CLIENT_ID = process.env.HOST_AWAY_CLIENT_ID!;
            const CLIENT_SECRET = process.env.HOST_AWAY_CLIENT_SECRET!;

            const haUserList = await this.hostAwayClient.getUserList(CLIENT_ID, CLIENT_SECRET);
            if (!haUserList || haUserList.length === 0) {
                logger.info(`[syncHostawayUser] No hostaway users found`);
                await this.hostawayUserRepo.clear(); // optional: clear all if empty from source
                return;
            }

            // Step 1: Build new data set from Hostaway
            const newHostawayEntries: { ha_userId: string; listingId: string; }[] = [];

            for (const haUser of haUserList) {
                const listingList = await this.hostAwayClient.getListingByUserId(haUser.id, CLIENT_ID, CLIENT_SECRET);
                for (const listing of listingList) {
                    newHostawayEntries.push({
                        ha_userId: haUser.id,
                        listingId: listing.id
                    });
                }
            }

            // Step 2: Fetch current database entries
            const existingEntries = await this.hostawayUserRepo.find();
            const existingMap = new Set(existingEntries.map(e => `${e.ha_userId}:${e.listingId}`));
            const newMap = new Set(newHostawayEntries.map(e => `${e.ha_userId}:${e.listingId}`));

            // Step 3: Delete outdated records
            const toDelete = existingEntries.filter(e => !newMap.has(`${e.ha_userId}:${e.listingId}`));
            if (toDelete.length > 0) {
                await this.hostawayUserRepo.remove(toDelete);
                logger.info(`[syncHostawayUser] Removed ${toDelete.length} outdated records`);
            }

            // Step 4: Insert new records
            const toInsert = newHostawayEntries.filter(e => !existingMap.has(`${e.ha_userId}:${e.listingId}`));
            if (toInsert.length > 0) {
                const newEntities = toInsert.map(e => this.hostawayUserRepo.create({
                    ha_userId: Number(e.ha_userId),
                    listingId: Number(e.listingId),
                }));
                await this.hostawayUserRepo.save(newEntities);
                logger.info(`[syncHostawayUser] Inserted ${toInsert.length} new records`);
            }

        } catch (err) {
            logger.error("[syncHostawayUser] Failed to sync Hostaway users", err);
        }
    }

}
