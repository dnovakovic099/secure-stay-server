import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { SmartLockDevice } from "../entity/SmartLockDevice";
import { PropertyDevice } from "../entity/PropertyDevice";
import { PropertyLockSettings } from "../entity/PropertyLockSettings";
import { AccessCode, AccessCodeStatus } from "../entity/AccessCode";
import { Listing } from "../entity/Listing";

export type LockConnectivity = "online" | "offline";
export type LockCodeState = "active" | "scheduled" | "failed" | "none";

export interface LockOverviewCode {
  id: number;
  code: string;
  codeName: string | null;
  guestName: string | null;
  status: AccessCodeStatus;
  scheduledAt: Date | null;
  expiresAt: Date | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  reservationId: number | null;
  source: string;
  setBy: string | null;
  errorMessage: string | null;
}

export interface LockOverviewRow {
  deviceId: number;
  externalDeviceId: string;
  provider: string;
  deviceName: string | null;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  imageUrl: string | null;

  isOnline: boolean;
  isLocked: boolean | null;
  batteryLevel: number | null;
  batteryStatus: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;

  propertyId: number | null;
  propertyName: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  locationLabel: string | null;
  isMapped: boolean;

  autoGenerateCodes: boolean;
  codeGenerationMode: string | null;

  /** The code a guest could physically punch in right now. */
  activeCode: LockOverviewCode | null;
  /** The next code due to be pushed to the lock. */
  nextCode: LockOverviewCode | null;
  recentFailure: LockOverviewCode | null;
  /**
   * False when the lock has no gateway, so codes can only be entered at the
   * keypad. Nothing in software fixes this — it needs a bridge installed.
   */
  canProgramRemotely: boolean;
  failedCodeCount: number;
  totalCodeCount: number;
  codeState: LockCodeState;
}

export interface LockOverviewFilters {
  search?: string;
  providers?: string[];
  connectivity?: LockConnectivity;
  codeState?: LockCodeState;
  mapped?: boolean;
  autoGenerate?: boolean;
  lowBattery?: boolean;
  hasError?: boolean;
  propertyId?: number;
}

export interface LockOverviewQuery extends LockOverviewFilters {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface LockOverviewStats {
  totalDevices: number;
  online: number;
  offline: number;
  unmapped: number;
  withActiveCode: number;
  failing: number;
  lowBattery: number;
  autoGenerateEnabled: number;
  providers: Array<{ provider: string; deviceCount: number }>;
}

/** Below this fraction the lock is close enough to dead to warrant a swap. */
const LOW_BATTERY_THRESHOLD = 0.25;

/** How long a device-level error stays worth acting on. */
const STALE_ERROR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sifely reports whether a lock is paired to a gateway. Without one the lock is
 * bluetooth-only, so no API can push a code to it however many times we retry.
 */
function canProgramRemotely(device: SmartLockDevice): boolean {
  if (device.provider !== "sifely") return true;
  const meta = (device.providerMetadata || {}) as Record<string, any>;
  return meta.hasGateway === 1;
}

/**
 * Whether a lock is failing in a way someone should do something about now, as
 * opposed to carrying the scar of an error from months ago.
 */
function hasLiveError(row: LockOverviewRow): boolean {
  if (row.failedCodeCount > 0) return true;
  if (!row.lastError) return false;
  if (!row.lastErrorAt) return true;
  return Date.now() - new Date(row.lastErrorAt).getTime() <= STALE_ERROR_MS;
}

function toCode(code: AccessCode): LockOverviewCode {
  return {
    id: code.id,
    code: code.code,
    codeName: code.codeName ?? null,
    guestName: code.guestName ?? null,
    status: code.status,
    scheduledAt: code.scheduledAt ?? null,
    expiresAt: code.expiresAt ?? null,
    checkInDate: code.checkInDate ?? null,
    checkOutDate: code.checkOutDate ?? null,
    reservationId: code.reservationId ?? null,
    source: code.source,
    setBy: code.setBy ?? null,
    errorMessage: code.errorMessage ?? null,
  };
}

/**
 * Assembles the single denormalized view behind the Locks page: device state,
 * property mapping, automation settings, and live codes in one row.
 *
 * Deliberately assembled in memory. The fleet is on the order of hundreds of
 * locks, and the interesting filters (which code is live *right now*) depend on
 * comparing several nullable timestamps against each other — expressing that in
 * SQL across MariaDB's date handling buys nothing and costs a lot of clarity.
 * If this ever needs to serve tens of thousands of devices, push the cheap
 * predicates (provider, online, property) into the query builder first.
 */
export class LockOverviewService {
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private settingsRepository = appDatabase.getRepository(PropertyLockSettings);
  private accessCodeRepository = appDatabase.getRepository(AccessCode);
  private listingRepository = appDatabase.getRepository(Listing);

  private async buildRows(): Promise<LockOverviewRow[]> {
    const [devices, mappings, settings] = await Promise.all([
      this.deviceRepository.find(),
      this.propertyDeviceRepository.find({ where: { isActive: true } }),
      this.settingsRepository.find(),
    ]);

    const propertyIds = Array.from(
      new Set(mappings.map((m) => m.propertyId).filter(Boolean))
    );
    const listings = propertyIds.length
      ? await this.listingRepository.find({ where: { id: In(propertyIds) } })
      : [];

    const deviceIds = devices.map((d) => d.id);
    const codes = deviceIds.length
      ? await this.accessCodeRepository.find({
          where: { deviceId: In(deviceIds) },
          order: { createdAt: "DESC" },
        })
      : [];

    const mappingByDevice = new Map<number, PropertyDevice>();
    for (const mapping of mappings) {
      // A device can be mapped to several properties in theory; in practice the
      // first active mapping is the one operators mean.
      if (!mappingByDevice.has(mapping.deviceId)) {
        mappingByDevice.set(mapping.deviceId, mapping);
      }
    }

    // listing_info.id is a bigint, which the driver hands back as a string,
    // while property_devices.property_id is an int and comes back as a number.
    // Key on the string form of both so the lookup actually matches — otherwise
    // every lock shows "Property 300017826" instead of the listing name.
    const listingById = new Map(listings.map((l) => [String(l.id), l]));
    const settingsByProperty = new Map(settings.map((s) => [s.propertyId, s]));

    const codesByDevice = new Map<number, AccessCode[]>();
    for (const code of codes) {
      const bucket = codesByDevice.get(code.deviceId);
      if (bucket) bucket.push(code);
      else codesByDevice.set(code.deviceId, [code]);
    }

    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    // Failures on codes with no stay attached age out rather than sticking forever.
    const staleFailureCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return devices.map((device) => {
      const mapping = mappingByDevice.get(device.id) || null;
      const listing = mapping ? listingById.get(String(mapping.propertyId)) || null : null;
      const propertySettings = mapping
        ? settingsByProperty.get(mapping.propertyId) || null
        : null;
      const deviceCodes = codesByDevice.get(device.id) || [];

      const activeCode =
        deviceCodes.find((code) => {
          if (code.status !== AccessCodeStatus.SET) return false;
          const started = !code.scheduledAt || new Date(code.scheduledAt) <= now;
          const notExpired = !code.expiresAt || new Date(code.expiresAt) > now;
          return started && notExpired;
        }) || null;

      const nextCode =
        deviceCodes
          .filter(
            (code) =>
              code.status === AccessCodeStatus.SCHEDULED &&
              code.scheduledAt &&
              new Date(code.scheduledAt) > now
          )
          .sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
          )[0] || null;

      // Only failures that still matter. A code that failed for a stay which
      // ended in April tells an operator nothing today, and hundreds of them
      // bury the handful of doors that genuinely need attention right now.
      const failedCodes = deviceCodes.filter((code) => {
        if (code.status !== AccessCodeStatus.FAILED) return false;
        if (code.checkOutDate) return new Date(code.checkOutDate) >= startOfToday;
        return new Date(code.createdAt) >= staleFailureCutoff;
      });

      let codeState: LockCodeState = "none";
      if (activeCode) codeState = "active";
      else if (failedCodes.length > 0) codeState = "failed";
      else if (nextCode) codeState = "scheduled";

      return {
        deviceId: device.id,
        externalDeviceId: device.externalDeviceId,
        provider: device.provider,
        deviceName: device.deviceName ?? null,
        deviceType: device.deviceType ?? null,
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
        serialNumber: device.serialNumber ?? null,
        imageUrl: device.imageUrl ?? null,

        isOnline: device.isOnline ?? false,
        isLocked: device.isLocked ?? null,
        batteryLevel: device.batteryLevel ?? null,
        batteryStatus: device.batteryStatus ?? null,
        lastSyncedAt: device.lastSyncedAt ?? null,
        lastError: device.lastError ?? null,
        lastErrorAt: device.lastErrorAt ?? null,

        propertyId: mapping?.propertyId ?? null,
        propertyName: listing?.name ?? null,
        propertyAddress: listing?.address ?? null,
        propertyCity: listing?.city ?? null,
        locationLabel: mapping?.locationLabel ?? null,
        isMapped: Boolean(mapping),

        autoGenerateCodes: propertySettings?.autoGenerateCodes ?? false,
        codeGenerationMode: propertySettings?.codeGenerationMode ?? null,

        activeCode: activeCode ? toCode(activeCode) : null,
        nextCode: nextCode ? toCode(nextCode) : null,
        recentFailure: failedCodes[0] ? toCode(failedCodes[0]) : null,
        canProgramRemotely: canProgramRemotely(device),
        failedCodeCount: failedCodes.length,
        totalCodeCount: deviceCodes.length,
        codeState,
      };
    });
  }

  private applyFilters(
    rows: LockOverviewRow[],
    filters: LockOverviewFilters
  ): LockOverviewRow[] {
    let result = rows;

    if (filters.search) {
      const needle = filters.search.trim().toLowerCase();
      if (needle) {
        result = result.filter((row) =>
          [
            row.deviceName,
            row.propertyName,
            row.propertyAddress,
            row.propertyCity,
            row.locationLabel,
            row.provider,
            row.model,
            row.manufacturer,
            row.serialNumber,
            row.externalDeviceId,
            row.activeCode?.code,
            row.activeCode?.guestName,
            row.nextCode?.code,
            row.nextCode?.guestName,
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(needle))
        );
      }
    }

    if (filters.providers?.length) {
      const set = new Set(filters.providers.map((p) => p.toLowerCase()));
      result = result.filter((row) => set.has(row.provider.toLowerCase()));
    }

    if (filters.connectivity) {
      const wantOnline = filters.connectivity === "online";
      result = result.filter((row) => row.isOnline === wantOnline);
    }

    if (filters.codeState) {
      result = result.filter((row) => row.codeState === filters.codeState);
    }

    if (filters.mapped !== undefined) {
      result = result.filter((row) => row.isMapped === filters.mapped);
    }

    if (filters.autoGenerate !== undefined) {
      result = result.filter((row) => row.autoGenerateCodes === filters.autoGenerate);
    }

    if (filters.lowBattery) {
      result = result.filter(
        (row) =>
          (row.batteryLevel !== null && row.batteryLevel <= LOW_BATTERY_THRESHOLD) ||
          row.batteryStatus === "critical" ||
          row.batteryStatus === "low"
      );
    }

    if (filters.hasError) {
      result = result.filter(hasLiveError);
    }

    if (filters.propertyId !== undefined) {
      result = result.filter((row) => row.propertyId === filters.propertyId);
    }

    return result;
  }

  private applySort(
    rows: LockOverviewRow[],
    sortBy = "deviceName",
    sortDir: "asc" | "desc" = "asc"
  ): LockOverviewRow[] {
    const direction = sortDir === "desc" ? -1 : 1;

    const value = (row: LockOverviewRow): string | number => {
      switch (sortBy) {
        case "property":
          return (row.propertyName || "").toLowerCase();
        case "provider":
          return row.provider.toLowerCase();
        case "battery":
          return row.batteryLevel ?? Number.POSITIVE_INFINITY;
        case "lastSyncedAt":
          return row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;
        case "codeState":
          return row.codeState;
        case "status":
          return row.isOnline ? 1 : 0;
        case "deviceName":
        default:
          return (row.deviceName || "").toLowerCase();
      }
    };

    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return a.deviceId - b.deviceId;
    });
  }

  async query(query: LockOverviewQuery): Promise<{
    rows: LockOverviewRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const all = await this.buildRows();
    const filtered = this.applyFilters(all, query);
    const sorted = this.applySort(filtered, query.sortBy, query.sortDir);

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(500, Math.max(1, query.pageSize || 50));
    const start = (page - 1) * pageSize;

    return {
      rows: sorted.slice(start, start + pageSize),
      total: sorted.length,
      page,
      pageSize,
    };
  }

  async stats(): Promise<LockOverviewStats> {
    const rows = await this.buildRows();

    const providerCounts = new Map<string, number>();
    for (const row of rows) {
      providerCounts.set(row.provider, (providerCounts.get(row.provider) || 0) + 1);
    }

    return {
      totalDevices: rows.length,
      online: rows.filter((r) => r.isOnline).length,
      offline: rows.filter((r) => !r.isOnline).length,
      unmapped: rows.filter((r) => !r.isMapped).length,
      withActiveCode: rows.filter((r) => r.codeState === "active").length,
      failing: rows.filter(hasLiveError).length,
      lowBattery: rows.filter(
        (r) =>
          (r.batteryLevel !== null && r.batteryLevel <= LOW_BATTERY_THRESHOLD) ||
          r.batteryStatus === "critical" ||
          r.batteryStatus === "low"
      ).length,
      autoGenerateEnabled: rows.filter((r) => r.autoGenerateCodes).length,
      providers: Array.from(providerCounts.entries())
        .map(([provider, deviceCount]) => ({ provider, deviceCount }))
        .sort((a, b) => b.deviceCount - a.deviceCount),
    };
  }

  /** Full detail for one device, including its complete code history. */
  async getDeviceDetail(deviceId: number): Promise<{
    row: LockOverviewRow;
    codes: LockOverviewCode[];
  } | null> {
    const rows = await this.buildRows();
    const row = rows.find((r) => r.deviceId === deviceId);
    if (!row) return null;

    const codes = await this.accessCodeRepository.find({
      where: { deviceId },
      order: { createdAt: "DESC" },
      take: 100,
    });

    return { row, codes: codes.map(toCode) };
  }
}
