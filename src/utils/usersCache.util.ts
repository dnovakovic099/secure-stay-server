import { appDatabase } from './database.util';
import { UsersEntity } from '../entity/Users';

// Module-level cache shared across all TypeORM subscribers in the same worker process.
// Prevents repeated full-table scans of the users table on every entity update event.
let cachedUserMap: Map<string, string> | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCachedUserMap(): Promise<Map<string, string>> {
    const now = Date.now();
    if (cachedUserMap && now < cacheExpiresAt) {
        return cachedUserMap;
    }
    const users = await appDatabase
        .getRepository(UsersEntity)
        .find({ select: ['uid', 'firstName', 'lastName'] });
    cachedUserMap = new Map(
        users.map(u => [u.uid, `${u.firstName} ${u.lastName}`])
    );
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedUserMap;
}

export function invalidateUsersCache(): void {
    cachedUserMap = null;
    cacheExpiresAt = 0;
}
