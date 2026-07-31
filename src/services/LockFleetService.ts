import { appDatabase } from "../utils/database.util";
import { LockFleetInventory } from "../entity/LockFleetInventory";
import { LockFixedCode } from "../entity/LockFixedCode";
import { SmartLockDevice } from "../entity/SmartLockDevice";

export interface FleetCoverageRow {
  platform: string;
  expectedCount: number;
  syncedCount: number;
  provider: string | null;
  automationPath: string;
  notes: string | null;
  status: "covered" | "partial" | "missing" | "fixed" | "replace";
}

/**
 * Compares the researched fleet inventory against devices actually synced into
 * smart_lock_devices so the Locks page can show "37 Schlage expected, 0 synced"
 * instead of an empty table that looks like success.
 */
export class LockFleetService {
  private inventoryRepository = appDatabase.getRepository(LockFleetInventory);
  private fixedCodeRepository = appDatabase.getRepository(LockFixedCode);
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);

  async getCoverage(): Promise<{
    rows: FleetCoverageRow[];
    expectedTotal: number;
    syncedTotal: number;
    fixedCodes: LockFixedCode[];
  }> {
    const [inventory, devices, fixedCodes] = await Promise.all([
      this.inventoryRepository.find({ order: { expectedCount: "DESC" } }),
      this.deviceRepository.find(),
      this.fixedCodeRepository.find({ where: { isActive: true } }),
    ]);

    const syncedByProvider = new Map<string, number>();
    for (const device of devices) {
      const key = device.provider.toLowerCase();
      syncedByProvider.set(key, (syncedByProvider.get(key) || 0) + 1);
    }

    // Inventory rows share providers (DD Lock + TTLock both map to "ttlock").
    // Allocate synced devices to inventory rows in expected-count order so a
    // shared provider doesn't get double-counted as fully covering every row.
    const remaining = new Map(syncedByProvider);
    const rows: FleetCoverageRow[] = inventory.map((item) => {
      const provider = item.provider?.toLowerCase() || null;
      let syncedCount = 0;
      if (provider && remaining.has(provider)) {
        const available = remaining.get(provider) || 0;
        syncedCount = Math.min(available, item.expectedCount);
        remaining.set(provider, available - syncedCount);
      }

      let status: FleetCoverageRow["status"];
      if (item.automationPath === "fixed") status = "fixed";
      else if (item.automationPath === "replace") status = "replace";
      else if (syncedCount >= item.expectedCount && item.expectedCount > 0) status = "covered";
      else if (syncedCount > 0) status = "partial";
      else status = "missing";

      return {
        platform: item.platform,
        expectedCount: item.expectedCount,
        syncedCount,
        provider: item.provider,
        automationPath: item.automationPath,
        notes: item.notes,
        status,
      };
    });

    return {
      rows,
      expectedTotal: inventory.reduce((sum, row) => sum + row.expectedCount, 0),
      syncedTotal: devices.length,
      fixedCodes,
    };
  }

  async listFixedCodes(): Promise<LockFixedCode[]> {
    return this.fixedCodeRepository.find({
      where: { isActive: true },
      order: { propertyName: "ASC" },
    });
  }
}
