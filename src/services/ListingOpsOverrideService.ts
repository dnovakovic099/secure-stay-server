import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { ListingOpsOverrideEntity } from "../entity/ListingOpsOverride";

export type OpsOverrideField =
    | "checkout_time"
    | "checkin_time"
    | "capacity"
    | "early_checkin_fee"
    | "late_checkout_fee";

/**
 * Staff overrides / quarantine for contested AI listing facts.
 * Table is created on first use (same pattern as EscalationSettingsService).
 */
export class ListingOpsOverrideService {
    private static ensured = false;

    async ensureTable(): Promise<void> {
        if (ListingOpsOverrideService.ensured) return;
        try {
            await appDatabase.query(`
                CREATE TABLE IF NOT EXISTS listing_ops_overrides (
                  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                  listingId BIGINT NOT NULL,
                  field VARCHAR(64) NOT NULL,
                  value VARCHAR(120) NULL,
                  status VARCHAR(20) NOT NULL DEFAULT 'active',
                  note VARCHAR(500) NULL,
                  createdByUserId INT NULL,
                  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  INDEX idx_listing_ops_listing (listingId),
                  INDEX idx_listing_ops_field (field)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            ListingOpsOverrideService.ensured = true;
        } catch (err: any) {
            logger.warn(`[ListingOpsOverride] ensureTable failed: ${err.message}`);
        }
    }

    async getForListings(listingIds: number[]): Promise<ListingOpsOverrideEntity[]> {
        const ids = (listingIds || []).map(Number).filter((n) => Number.isFinite(n));
        if (!ids.length) return [];
        await this.ensureTable();
        try {
            const repo = appDatabase.getRepository(ListingOpsOverrideEntity);
            return await repo
                .createQueryBuilder("o")
                .where("o.listingId IN (:...ids)", { ids })
                .andWhere("o.status IN ('active','quarantined')")
                .getMany();
        } catch (err: any) {
            logger.warn(`[ListingOpsOverride] getForListings failed: ${err.message}`);
            return [];
        }
    }
}
