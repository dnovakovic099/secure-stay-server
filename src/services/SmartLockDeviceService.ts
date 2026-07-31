import { appDatabase } from "../utils/database.util";
import { SmartLockDevice } from "../entity/SmartLockDevice";
import { PropertyDevice } from "../entity/PropertyDevice";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import { Device } from "../interfaces/ILockProvider";
import { LockProviderHealthService } from "./LockProviderHealthService";
import logger from "../utils/logger.utils";

export interface MappingReviewRow {
  mappingId: number;
  propertyId: number;
  propertyName: string | null;
  deviceId: number;
  deviceName: string | null;
  provider: string | null;
  manufacturer: string | null;
  locationLabel: string | null;
  isGuestDoor: boolean;
  verificationStatus: string;
  verificationNote: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
}

/**
 * Smart Lock Device Service
 * Manages smart lock devices and property-device mappings
 */
export class SmartLockDeviceService {
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private healthService = new LockProviderHealthService();

  /**
   * Sync devices from a lock provider
   */
  async syncDevicesFromProvider(
    provider: string,
    connectedAccountId?: string
  ): Promise<SmartLockDevice[]> {
    const lockProvider = LockProviderFactory.getProvider(provider);
    const providerDevices = await lockProvider.listDevices(connectedAccountId);

    const syncedDevices: SmartLockDevice[] = [];

    for (const device of providerDevices) {
      const syncedDevice = await this.upsertDevice(device);
      syncedDevices.push(syncedDevice);
    }

    // Best-effort: a bookkeeping failure must not fail an otherwise good sync.
    try {
      await this.healthService.recordSync(provider, syncedDevices.length);
    } catch (error: any) {
      logger.warn(`Failed to record sync status for ${provider}: ${error?.message}`);
    }

    logger.info(`Synced ${syncedDevices.length} devices from ${provider}`);
    return syncedDevices;
  }

  /**
   * Upsert a device (create or update)
   */
  async upsertDevice(deviceData: Device): Promise<SmartLockDevice> {
    let device = await this.deviceRepository.findOne({
      where: {
        provider: deviceData.provider,
        externalDeviceId: deviceData.externalDeviceId,
      },
    });

    if (device) {
      // Update existing device
      device.deviceName = deviceData.deviceName || device.deviceName;
      device.deviceType = deviceData.deviceType || device.deviceType;
      device.manufacturer = deviceData.manufacturer || device.manufacturer;
      device.model = deviceData.model || device.model;
      device.locationName = deviceData.locationName || device.locationName;
      device.isOnline = deviceData.isOnline ?? device.isOnline;
      device.capabilities = deviceData.capabilities || device.capabilities;
      device.providerMetadata = deviceData.providerMetadata || device.providerMetadata;
    } else {
      // Create new device
      device = this.deviceRepository.create({
        externalDeviceId: deviceData.externalDeviceId,
        provider: deviceData.provider,
        connectedAccountId: deviceData.connectedAccountId,
        deviceName: deviceData.deviceName,
        deviceType: deviceData.deviceType,
        manufacturer: deviceData.manufacturer,
        model: deviceData.model,
        locationName: deviceData.locationName,
        isOnline: deviceData.isOnline ?? true,
        capabilities: deviceData.capabilities,
        providerMetadata: deviceData.providerMetadata,
      });
    }

    // Telemetry is refreshed on every sync. Unlike the descriptive fields above
    // these use `??` rather than `||` so a legitimate 0 (flat battery, unlocked)
    // is not discarded as falsy.
    device.batteryLevel = deviceData.batteryLevel ?? device.batteryLevel;
    device.batteryStatus = deviceData.batteryStatus ?? device.batteryStatus;
    device.isLocked = deviceData.isLocked ?? device.isLocked;
    device.serialNumber = deviceData.serialNumber ?? device.serialNumber;
    device.imageUrl = deviceData.imageUrl ?? device.imageUrl;
    device.lastSyncedAt = new Date();

    return await this.deviceRepository.save(device);
  }

  /**
   * Get all devices
   */
  async getAllDevices(): Promise<SmartLockDevice[]> {
    return await this.deviceRepository.find({
      relations: ["accessCodes"],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get device by ID
   */
  async getDeviceById(id: number): Promise<SmartLockDevice | null> {
    return await this.deviceRepository.findOne({
      where: { id },
    });
  }

  /**
   * Get device by external ID and provider
   */
  async getDeviceByExternalId(
    provider: string,
    externalDeviceId: string
  ): Promise<SmartLockDevice | null> {
    return await this.deviceRepository.findOne({
      where: { provider, externalDeviceId },
    });
  }

  /**
   * Map a device to a property
   */
  async mapDeviceToProperty(
    deviceId: number,
    propertyId: number,
    locationLabel?: string,
    isActive = true
  ): Promise<PropertyDevice> {
    // Check if mapping already exists
    let mapping = await this.propertyDeviceRepository.findOne({
      where: { deviceId, propertyId },
    });

    if (mapping) {
      // Update existing mapping
      mapping.locationLabel = locationLabel || mapping.locationLabel;
      mapping.isActive = isActive;
    } else {
      // Create new mapping
      mapping = this.propertyDeviceRepository.create({
        deviceId,
        propertyId,
        locationLabel,
        isActive,
      });
    }

    return await this.propertyDeviceRepository.save(mapping);
  }

  /**
   * Remove device-property mapping
   */
  async unmapDeviceFromProperty(
    deviceId: number,
    propertyId: number
  ): Promise<void> {
    await this.propertyDeviceRepository.delete({
      deviceId,
      propertyId,
    });
  }

  /**
   * Get all devices for a property
   */
  async getDevicesForProperty(propertyId: number): Promise<PropertyDevice[]> {
    return await this.propertyDeviceRepository.find({
      where: { propertyId, isActive: true },
      relations: ["device"],
    });
  }

  /**
   * Get all property mappings for a device
   */
  async getPropertiesForDevice(deviceId: number): Promise<PropertyDevice[]> {
    return await this.propertyDeviceRepository.find({
      where: { deviceId },
    });
  }

  /**
   * Get all mappings
   */
  async getAllMappings(): Promise<PropertyDevice[]> {
    return await this.propertyDeviceRepository.find({
      relations: ["device", "property"],
    });
  }

  /**
   * Every active mapping, for a person to check that each lock really does open
   * the unit we think it does. Unverified mappings come first because those are
   * the ones nobody has ever looked at.
   */
  async getMappingsForReview(): Promise<MappingReviewRow[]> {
    const mappings = await this.propertyDeviceRepository.find({
      where: { isActive: true },
      relations: ["device", "property"],
    });

    const order: Record<string, number> = { unverified: 0, evidence_matched: 1, confirmed: 2 };

    return mappings
      .map((m) => ({
        mappingId: m.id,
        propertyId: m.propertyId,
        propertyName: m.property?.name || null,
        deviceId: m.deviceId,
        deviceName: m.device?.deviceName || null,
        provider: m.device?.provider || null,
        manufacturer: m.device?.manufacturer || null,
        locationLabel: m.locationLabel || null,
        isGuestDoor: m.isGuestDoor,
        verificationStatus: m.verificationStatus,
        verificationNote: m.verificationNote,
        confirmedBy: m.confirmedBy,
        confirmedAt: m.confirmedAt,
      }))
      .sort((a, b) => {
        const byStatus =
          (order[a.verificationStatus] ?? 0) - (order[b.verificationStatus] ?? 0);
        if (byStatus !== 0) return byStatus;
        return (a.propertyName || "").localeCompare(b.propertyName || "");
      });
  }

  /**
   * Record a rep's decision about a mapping.
   *
   * Rejecting deactivates the mapping rather than deleting it: if a lock does
   * not open the unit we thought, the urgent thing is to stop sending that
   * unit's guests to it, while keeping the record so nobody re-creates the same
   * wrong mapping later.
   */
  async setMappingVerification(
    mappingId: number,
    decision: "confirmed" | "rejected",
    actor: string,
    note?: string
  ): Promise<PropertyDevice> {
    const mapping = await this.propertyDeviceRepository.findOne({
      where: { id: mappingId },
      relations: ["device"],
    });
    if (!mapping) {
      throw new Error(`Mapping ${mappingId} not found`);
    }

    mapping.verificationStatus = decision;
    mapping.confirmedBy = actor;
    mapping.confirmedAt = new Date();
    if (note) mapping.verificationNote = note;
    if (decision === "rejected") mapping.isActive = false;

    return await this.propertyDeviceRepository.save(mapping);
  }

  /**
   * Delete a device and all its mappings
   */
  async deleteDevice(id: number): Promise<void> {
    await this.deviceRepository.delete(id);
  }

  /**
   * Update device online status
   */
  async updateDeviceOnlineStatus(
    id: number,
    isOnline: boolean
  ): Promise<SmartLockDevice | null> {
    await this.deviceRepository.update(id, { isOnline });
    return await this.getDeviceById(id);
  }
}
