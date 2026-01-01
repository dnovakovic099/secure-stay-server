import { appDatabase } from "../utils/database.util";
import { SmartLockDevice } from "../entity/SmartLockDevice";
import { PropertyDevice } from "../entity/PropertyDevice";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import { Device } from "../interfaces/ILockProvider";
import logger from "../utils/logger.utils";

/**
 * Smart Lock Device Service
 * Manages smart lock devices and property-device mappings
 */
export class SmartLockDeviceService {
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);

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
    locationLabel?: string
  ): Promise<PropertyDevice> {
    // Check if mapping already exists
    let mapping = await this.propertyDeviceRepository.findOne({
      where: { deviceId, propertyId },
    });

    if (mapping) {
      // Update existing mapping
      mapping.locationLabel = locationLabel || mapping.locationLabel;
      mapping.isActive = true;
    } else {
      // Create new mapping
      mapping = this.propertyDeviceRepository.create({
        deviceId,
        propertyId,
        locationLabel,
        isActive: true,
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
      where: { isActive: true },
      relations: ["device", "property"],
    });
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
