import { appDatabase } from "../utils/database.util";
import { AccessCode, AccessCodeStatus } from "../entity/AccessCode";
import { PropertyLockSettings, CodeGenerationMode } from "../entity/PropertyLockSettings";
import { PropertyDevice } from "../entity/PropertyDevice";
import { SmartLockDevice } from "../entity/SmartLockDevice";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import logger from "../utils/logger.utils";

/**
 * Smart Lock Access Code Service
 * Manages access code generation, creation, and tracking
 */
export class SmartLockAccessCodeService {
  private accessCodeRepository = appDatabase.getRepository(AccessCode);
  private settingsRepository = appDatabase.getRepository(PropertyLockSettings);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);

  /**
   * Generate access code based on guest phone number or settings
   */
  generateAccessCode(
    guestPhone: string | null,
    settings: PropertyLockSettings | null
  ): string {
    // If settings specify default mode and we have a default code
    if (
      settings?.codeGenerationMode === CodeGenerationMode.DEFAULT &&
      settings?.defaultAccessCode
    ) {
      return settings.defaultAccessCode;
    }

    // Try to extract last 4 digits from phone
    if (guestPhone && settings?.codeGenerationMode !== CodeGenerationMode.RANDOM) {
      const digits = guestPhone.replace(/\D/g, "");
      if (digits.length >= 4) {
        return digits.slice(-4);
      }
    }

    // Fallback: generate random 4-digit code
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /**
   * Get or create property lock settings
   */
  async getOrCreateSettings(propertyId: number): Promise<PropertyLockSettings> {
    let settings = await this.settingsRepository.findOne({
      where: { propertyId },
    });

    if (!settings) {
      settings = this.settingsRepository.create({
        propertyId,
        autoGenerateCodes: false,
        codeGenerationMode: CodeGenerationMode.PHONE,
        hoursBeforeCheckin: 1,
      });
      settings = await this.settingsRepository.save(settings);
    }

    return settings;
  }

  /**
   * Update property lock settings
   */
  async updateSettings(
    propertyId: number,
    updates: Partial<PropertyLockSettings>
  ): Promise<PropertyLockSettings> {
    let settings = await this.getOrCreateSettings(propertyId);

    if (updates.autoGenerateCodes !== undefined) {
      settings.autoGenerateCodes = updates.autoGenerateCodes;
    }
    if (updates.defaultAccessCode !== undefined) {
      settings.defaultAccessCode = updates.defaultAccessCode;
    }
    if (updates.codeGenerationMode !== undefined) {
      settings.codeGenerationMode = updates.codeGenerationMode;
    }
    if (updates.hoursBeforeCheckin !== undefined) {
      settings.hoursBeforeCheckin = updates.hoursBeforeCheckin;
    }

    return await this.settingsRepository.save(settings);
  }

  /**
   * Get all property lock settings
   */
  async getAllSettings(): Promise<PropertyLockSettings[]> {
    return await this.settingsRepository.find();
  }

  /**
   * Delete/Reset property lock settings
   */
  async deleteSettings(propertyId: number): Promise<void> {
    await this.settingsRepository.delete({ propertyId });
  }

  /**
   * Create access codes for a reservation (for all devices mapped to property)
   */
  async createAccessCodesForReservation(params: {
    reservationId: number;
    propertyId: number;
    guestName?: string;
    guestPhone?: string;
    checkInDate: Date;
  }): Promise<AccessCode[]> {
    const { reservationId, propertyId, guestName, guestPhone, checkInDate } = params;

    // Get property settings
    const settings = await this.getOrCreateSettings(propertyId);

    // Get all devices for this property
    const propertyDevices = await this.propertyDeviceRepository.find({
      where: { propertyId, isActive: true },
      relations: ["device"],
    });

    if (propertyDevices.length === 0) {
      logger.warn(`No devices mapped to property ${propertyId}`);
      return [];
    }

    // Generate the access code
    const code = this.generateAccessCode(guestPhone || null, settings);
    const codeName = guestName
      ? `Guest: ${guestName}`
      : `Reservation #${reservationId}`;

    // Calculate scheduled time (1 hour before check-in by default)
    const scheduledAt = new Date(checkInDate);
    scheduledAt.setHours(scheduledAt.getHours() - settings.hoursBeforeCheckin);

    const accessCodes: AccessCode[] = [];

    // Create access code for each device
    for (const propertyDevice of propertyDevices) {
      const device = propertyDevice.device;

      // Check if code already exists for this reservation and device
      const existingCode = await this.accessCodeRepository.findOne({
        where: {
          reservationId,
          deviceId: device.id,
        },
      });

      if (existingCode) {
        logger.info(
          `Access code already exists for reservation ${reservationId} on device ${device.id}`
        );
        accessCodes.push(existingCode);
        continue;
      }

      const accessCode = this.accessCodeRepository.create({
        provider: device.provider,
        deviceId: device.id,
        propertyId,
        reservationId,
        guestName,
        guestPhone,
        code,
        codeName,
        status: AccessCodeStatus.SCHEDULED,
        scheduledAt,
      });

      const savedCode = await this.accessCodeRepository.save(accessCode);
      accessCodes.push(savedCode);

      logger.info(
        `Created access code for reservation ${reservationId} on device ${device.id}, scheduled for ${scheduledAt}`
      );
    }

    return accessCodes;
  }

  /**
   * Create a manual access code for a device
   */
  async createManualAccessCode(params: {
    deviceId: number;
    propertyId: number;
    code: string;
    codeName: string;
    guestName?: string;
    guestPhone?: string;
    reservationId?: number;
    setImmediately?: boolean;
  }): Promise<AccessCode> {
    const device = await this.deviceRepository.findOne({
      where: { id: params.deviceId },
    });

    if (!device) {
      throw new Error(`Device not found: ${params.deviceId}`);
    }

    const accessCode = this.accessCodeRepository.create({
      provider: device.provider,
      deviceId: params.deviceId,
      propertyId: params.propertyId,
      reservationId: params.reservationId,
      guestName: params.guestName,
      guestPhone: params.guestPhone,
      code: params.code,
      codeName: params.codeName,
      status: params.setImmediately
        ? AccessCodeStatus.PENDING
        : AccessCodeStatus.SCHEDULED,
    });

    const savedCode = await this.accessCodeRepository.save(accessCode);

    if (params.setImmediately) {
      return await this.setAccessCodeOnDevice(savedCode.id);
    }

    return savedCode;
  }

  /**
   * Set an access code on the actual device via provider API
   */
  async setAccessCodeOnDevice(accessCodeId: number): Promise<AccessCode> {
    const accessCode = await this.accessCodeRepository.findOne({
      where: { id: accessCodeId },
      relations: ["device"],
    });

    if (!accessCode) {
      throw new Error(`Access code not found: ${accessCodeId}`);
    }

    const device = accessCode.device;
    const provider = LockProviderFactory.getProvider(device.provider);

    try {
      const result = await provider.createAccessCode({
        deviceId: device.externalDeviceId,
        code: accessCode.code,
        name: accessCode.codeName || `Code ${accessCode.id}`,
      });

      accessCode.externalCodeId = result.externalCodeId;
      accessCode.status = AccessCodeStatus.SET;
      accessCode.setAt = new Date();
      accessCode.providerStatus = result.status;
      accessCode.providerMetadata = result.providerMetadata;
      accessCode.errorMessage = null;

      logger.info(`Access code ${accessCodeId} set successfully on device ${device.id}`);
    } catch (error: any) {
      accessCode.status = AccessCodeStatus.FAILED;
      accessCode.errorMessage = error.message || "Failed to set access code";
      logger.error(`Failed to set access code ${accessCodeId}:`, error);
    }

    return await this.accessCodeRepository.save(accessCode);
  }

  /**
   * Delete an access code from device and database
   */
  async deleteAccessCode(accessCodeId: number): Promise<void> {
    const accessCode = await this.accessCodeRepository.findOne({
      where: { id: accessCodeId },
      relations: ["device"],
    });

    if (!accessCode) {
      throw new Error(`Access code not found: ${accessCodeId}`);
    }

    // If code was set on device, delete it from provider
    if (accessCode.externalCodeId && accessCode.status === AccessCodeStatus.SET) {
      const provider = LockProviderFactory.getProvider(accessCode.device.provider);
      try {
        await provider.deleteAccessCode(accessCode.externalCodeId);
        logger.info(`Deleted access code ${accessCodeId} from device`);
      } catch (error: any) {
        logger.error(`Failed to delete access code from device:`, error);
        // Continue to delete from database anyway
      }
    }

    await this.accessCodeRepository.delete(accessCodeId);
  }

  /**
   * Get all access codes
   */
  async getAllAccessCodes(): Promise<AccessCode[]> {
    return await this.accessCodeRepository.find({
      relations: ["device"],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get access codes for a property
   */
  async getAccessCodesForProperty(propertyId: number): Promise<AccessCode[]> {
    return await this.accessCodeRepository.find({
      where: { propertyId },
      relations: ["device"],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get access codes for a reservation
   */
  async getAccessCodesForReservation(reservationId: number): Promise<AccessCode[]> {
    return await this.accessCodeRepository.find({
      where: { reservationId },
      relations: ["device"],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get access code by ID
   */
  async getAccessCodeById(id: number): Promise<AccessCode | null> {
    return await this.accessCodeRepository.findOne({
      where: { id },
      relations: ["device"],
    });
  }

  /**
   * Update access code
   */
  async updateAccessCode(
    id: number,
    updates: Partial<AccessCode>
  ): Promise<AccessCode | null> {
    await this.accessCodeRepository.update(id, updates);
    return await this.getAccessCodeById(id);
  }

  /**
   * Get scheduled access codes that need to be set
   */
  async getScheduledCodesReadyToSet(): Promise<AccessCode[]> {
    const now = new Date();
    return await this.accessCodeRepository
      .createQueryBuilder("ac")
      .leftJoinAndSelect("ac.device", "device")
      .where("ac.status = :status", { status: AccessCodeStatus.SCHEDULED })
      .andWhere("ac.scheduledAt <= :now", { now })
      .getMany();
  }

  /**
   * Process scheduled access codes (called by scheduler)
   */
  async processScheduledCodes(): Promise<{ processed: number; failed: number; }> {
    const scheduledCodes = await this.getScheduledCodesReadyToSet();

    let processed = 0;
    let failed = 0;

    for (const code of scheduledCodes) {
      try {
        await this.setAccessCodeOnDevice(code.id);
        processed++;
      } catch (error) {
        failed++;
        logger.error(`Failed to process scheduled code ${code.id}:`, error);
      }
    }

    if (scheduledCodes.length > 0) {
      logger.info(`Processed ${processed} scheduled codes, ${failed} failed`);
    }

    return { processed, failed };
  }
}
