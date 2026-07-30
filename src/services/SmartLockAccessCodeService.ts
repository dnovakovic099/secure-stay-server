import { appDatabase } from "../utils/database.util";
import { AccessCode, AccessCodeStatus, AccessCodeSource } from "../entity/AccessCode";
import { PropertyLockSettings, CodeGenerationMode } from "../entity/PropertyLockSettings";
import { PropertyDevice } from "../entity/PropertyDevice";
import { SmartLockDevice } from "../entity/SmartLockDevice";
import { Listing } from "../entity/Listing";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import logger from "../utils/logger.utils";

/**
 * Convert a wall-clock (year, month, day, hour) in `timeZone` to the equivalent UTC Date.
 * Uses Intl.DateTimeFormat to reverse-engineer the timezone offset for the given instant,
 * which correctly handles DST transitions and does not depend on the Node process timezone.
 */
function zonedWallClockToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(naiveUtc));
  const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const zonedYear = lookup("year");
  const zonedMonth = lookup("month");
  const zonedDay = lookup("day");
  let zonedHour = lookup("hour");
  if (zonedHour === 24) zonedHour = 0; // en-US with hour12:false returns "24" for midnight
  const zonedMinute = lookup("minute");
  const zonedAsUtc = Date.UTC(zonedYear, zonedMonth - 1, zonedDay, zonedHour, zonedMinute, 0);
  const offset = zonedAsUtc - naiveUtc;
  return new Date(naiveUtc - offset);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/**
 * Smart Lock Access Code Service
 * Manages access code generation, creation, and tracking
 */
export class SmartLockAccessCodeService {
  private accessCodeRepository = appDatabase.getRepository(AccessCode);
  private settingsRepository = appDatabase.getRepository(PropertyLockSettings);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private deviceRepository = appDatabase.getRepository(SmartLockDevice);
  private listingRepository = appDatabase.getRepository(Listing);

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
        hoursBeforeCheckin: 3,
        hoursAfterCheckout: 3,
      });
      settings = await this.settingsRepository.save(settings);
    }

    return settings;
  }

  /**
 * Get settings with timezone and check-in/check-out times from Listing entity
 */
  async getSettingsWithTimezone(propertyId: number): Promise<PropertyLockSettings & { timezone: string; checkInTimeStart: number | null; checkOutTime: number | null; }> {
    const settings = await this.getOrCreateSettings(propertyId);
    const listing = await this.listingRepository.findOne({ where: { id: propertyId } });
    return {
      ...settings,
      timezone: listing?.timeZoneName || 'America/New_York', // fallback
    checkInTimeStart: listing?.checkInTimeStart ?? null,
    checkOutTime: listing?.checkOutTime ?? null,
  };
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
    if (updates.hoursAfterCheckout !== undefined) {
      settings.hoursAfterCheckout = updates.hoursAfterCheckout;
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
    checkOutDate?: Date;
    checkInTime?: number; // Hour (0-23), null means use fallback
    checkOutTime?: number; // Hour (0-23), null means use fallback
    source?: AccessCodeSource;
  }): Promise<AccessCode[]> {
    const {
      reservationId,
      propertyId,
      guestName,
      guestPhone,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      source = AccessCodeSource.MANUAL
    } = params;

    // Get property settings with timezone
    const settingsWithTimezone = await this.getSettingsWithTimezone(propertyId);
    const settings = await this.getOrCreateSettings(propertyId);

    // Get listing for timezone (default to America/New_York if not set)
    const listing = await this.listingRepository.findOne({ where: { id: propertyId } });
    const timezone = listing?.timeZoneName || "America/New_York";

    const toZoned = (date: Date, hour: number) => zonedWallClockToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      timezone,
    );

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

    // Generate code name: "Guest Name - Checkin Date - Checkout Date"
    const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const codeName = guestName && checkOutDate
      ? `${guestName} - ${formatDate(checkInDate)} - ${formatDate(checkOutDate)}`
      : guestName
        ? `Guest: ${guestName}`
        : `Reservation #${reservationId}`;

    // Calculate scheduled time (hours before check-in)
    // Use provided checkInTime, then the listing's configured check-in hour,
    // then fall back to 15 (3 PM) which is the common industry default.
    const actualCheckInHour = checkInTime ?? settingsWithTimezone.checkInTimeStart ?? 15;

    // Convert check-in time from listing timezone to UTC
    const scheduledAt = addHours(
      toZoned(new Date(checkInDate), actualCheckInHour),
      -settings.hoursBeforeCheckin,
    );

    logger.info(`[AccessCode] Timezone conversion for reservation ${reservationId}: timezone=${timezone}, checkInHour=${actualCheckInHour}, scheduledAt=${scheduledAt.toISOString()}, hoursBeforeCheckin=${settings.hoursBeforeCheckin}`);

    // Calculate expiration time (hours after check-out)
    let expiresAt: Date | null = null;
    if (checkOutDate) {
      // Use provided checkOutTime, then the listing's configured check-out
      // hour, then fall back to 11 (11 AM) which is the common industry default.
      const actualCheckOutHour = checkOutTime ?? settingsWithTimezone.checkOutTime ?? 11;

      // Convert check-out time from listing timezone to UTC
      expiresAt = addHours(
        toZoned(new Date(checkOutDate), actualCheckOutHour),
        settings.hoursAfterCheckout,
      );

      logger.info(`[AccessCode] Timezone conversion for reservation ${reservationId}: checkOutHour=${actualCheckOutHour}, expiresAt=${expiresAt.toISOString()}, hoursAfterCheckout=${settings.hoursAfterCheckout}`);
    }

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
        source,
        checkInDate,
        checkOutDate: checkOutDate || null,
        expiresAt,
      });

      const savedCode = await this.accessCodeRepository.save(accessCode);
      accessCodes.push(savedCode);

      logger.info(
        `Created access code for reservation ${reservationId} on device ${device.id}, scheduled for ${scheduledAt}, expires at ${expiresAt}`
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
   * Uses pre-calculated scheduledAt (startsAt) and expiresAt from the access code record
   * Only recalculates if those values are missing
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

    // Use stored values if available (already calculated by createAccessCodesForReservation)
    let startsAt: Date | null = accessCode.scheduledAt;
    let endsAt: Date | null = accessCode.expiresAt;
    let codeName = accessCode.codeName;

    // Only recalculate if values are missing (fallback for legacy or manual codes)
    if (!startsAt || !endsAt) {
      logger.info(`[AccessCode] Missing startsAt or endsAt for code ${accessCodeId}, recalculating...`);

      // Get listing for check-in/check-out times and timezone
      const listing = await this.listingRepository.findOne({
        where: { id: accessCode.propertyId },
      });

      // Get property settings for hours before/after
      const settings = await this.getOrCreateSettings(accessCode.propertyId);

      // Calculate validity dates
      const calculated = this.calculateCodeValidity(accessCode, listing, settings);

      startsAt = startsAt || calculated.startsAt;
      endsAt = endsAt || calculated.endsAt;
      codeName = calculated.codeName || codeName;
    } else {
      logger.info(`[AccessCode] Using pre-calculated times for code ${accessCodeId}: startsAt=${startsAt.toISOString()}, endsAt=${endsAt.toISOString()}`);
    }

    try {
      // Sifely locks without a gateway (or with remote disabled) will silently
      // accept the API call and return a keyboardPwdId while never actually
      // programming the lock — leaving guests locked out. Fail fast instead.
      if (device.provider === "sifely") {
        const meta = (device.providerMetadata || {}) as Record<string, any>;
        if (meta.hasGateway !== 1) {
          throw new Error("Sifely lock has no gateway connected; passcode cannot be set remotely.");
        }
        if (meta.remoteEnable !== 1) {
          throw new Error("Sifely lock has remote passcode setting disabled.");
        }
      }

      logger.info(`Setting access code ${accessCodeId} with validity: ${startsAt?.toISOString()} to ${endsAt?.toISOString()}`);

      const result = await provider.createAccessCode({
        deviceId: device.externalDeviceId,
        code: accessCode.code,
        name: accessCode.codeName || `Code ${accessCode.id}`,
        startsAt: startsAt?.toISOString(),
        endsAt: endsAt?.toISOString(),
      });

      accessCode.externalCodeId = result.externalCodeId;
      accessCode.status = AccessCodeStatus.SET;
      accessCode.setAt = new Date();
      accessCode.providerStatus = result.status;
      accessCode.providerMetadata = result.providerMetadata;
      accessCode.errorMessage = null;

      // Update expiresAt if we calculated it
      if (endsAt) {
        accessCode.expiresAt = endsAt;
      }

      logger.info(`Access code ${accessCodeId} set successfully on device ${device.id}`);
    } catch (error: any) {
      accessCode.status = AccessCodeStatus.FAILED;
      accessCode.errorMessage = error.message || "Failed to set access code";
      logger.error(`Failed to set access code ${accessCodeId}:`, error);
    }

    return await this.accessCodeRepository.save(accessCode);
  }

  /**
   * Calculate code validity (startsAt and endsAt) based on listing and settings
   * Uses listing timezone to properly calculate dates in the property's local time
   */
  private calculateCodeValidity(
    accessCode: AccessCode,
    listing: Listing | null,
    settings: PropertyLockSettings
  ): { startsAt: Date | null; endsAt: Date | null; codeName: string; } {
    const checkInDate = accessCode.checkInDate;
    const checkOutDate = accessCode.checkOutDate;

    if (!checkInDate) {
      return { startsAt: null, endsAt: null, codeName: accessCode.codeName };
    }

    // Get timezone from listing or default to America/New_York
    const timezone = listing?.timeZoneName || "America/New_York";

    // Get check-in and check-out times from listing, with sensible fallbacks
    const checkInHour = listing?.checkInTimeStart ?? 15; // 3 PM default
    const checkOutHour = listing?.checkOutTime ?? 11;   // 11 AM default

    const zonedForDate = (date: Date, hour: number): Date => zonedWallClockToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      timezone,
    );

    // Calculate startsAt: checkInDate at checkInHour (local tz) minus hoursBeforeCheckin
    const startsAt = addHours(
      zonedForDate(new Date(checkInDate), checkInHour),
      -(settings.hoursBeforeCheckin || 0),
    );

    // Calculate endsAt: checkOutDate at checkOutHour (local tz) plus hoursAfterCheckout
    let endsAt: Date | null = null;
    if (checkOutDate) {
      endsAt = addHours(
        zonedForDate(new Date(checkOutDate), checkOutHour),
        settings.hoursAfterCheckout || 0,
      );
    }

    // Format code name: "Guest Name - Jan 8 - Jan 13"
    const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let codeName = accessCode.codeName;
    if (accessCode.guestName && checkInDate && checkOutDate) {
      codeName = `${accessCode.guestName} - ${formatDate(new Date(checkInDate))} - ${formatDate(new Date(checkOutDate))}`;
    } else if (accessCode.guestName) {
      codeName = `Guest: ${accessCode.guestName}`;
    }

    logger.info(`Code validity calculated for timezone ${timezone}: startsAt=${startsAt.toISOString()}, endsAt=${endsAt?.toISOString()}, checkInHour=${checkInHour}, checkOutHour=${checkOutHour}, hoursBeforeCheckin=${settings.hoursBeforeCheckin}, hoursAfterCheckout=${settings.hoursAfterCheckout}`);

    return { startsAt, endsAt, codeName };
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

    // If the code was already set on the physical device, remove it upstream
    // first. If that fails, leave the DB row in place and mark the failure —
    // deleting locally would strand an active code on the lock.
    if (accessCode.externalCodeId && accessCode.status === AccessCodeStatus.SET) {
      const provider = LockProviderFactory.getProvider(accessCode.device.provider);
      try {
        await provider.deleteAccessCode(accessCode.externalCodeId);
        logger.info(`Deleted access code ${accessCodeId} from device`);
      } catch (error: any) {
        logger.error(`Failed to delete access code ${accessCodeId} from provider:`, error);
        accessCode.errorMessage = `Provider delete failed: ${error?.message || "unknown error"}`;
        await this.accessCodeRepository.save(accessCode);
        throw new Error(
          `Failed to remove code from device: ${error?.message || "unknown error"}. ` +
          "Local record kept to avoid orphaning an active code on the lock."
        );
      }
    }

    await this.accessCodeRepository.delete(accessCodeId);
  }

  /**
   * Get all access codes ordered by check-in date (today first, then future)
   */
  async getAllAccessCodes(): Promise<AccessCode[]> {
    return await this.accessCodeRepository.find({
      relations: ["device"],
      order: {
        checkInDate: "ASC",  // Today first, then future dates
        createdAt: "DESC"    // Secondary: newest first within same date
      },
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
   * Update access code (DB) and, if the code is already set on the device,
   * propagate `code`/`name` changes to the provider so the physical lock stays
   * in sync. Time-window fields are not propagated here — callers who want to
   * change validity should delete and recreate the code.
   */
  async updateAccessCode(
    id: number,
    updates: Partial<AccessCode>
  ): Promise<AccessCode | null> {
    const existing = await this.accessCodeRepository.findOne({
      where: { id },
      relations: ["device"],
    });
    if (!existing) return null;

    await this.accessCodeRepository.update(id, updates);
    const refreshed = await this.getAccessCodeById(id);
    if (!refreshed) return null;

    const codeChanged = updates.code !== undefined && updates.code !== existing.code;
    const nameChanged = updates.codeName !== undefined && updates.codeName !== existing.codeName;
    const shouldPropagate =
      (codeChanged || nameChanged) &&
      existing.status === AccessCodeStatus.SET &&
      existing.externalCodeId;

    if (!shouldPropagate) return refreshed;

    try {
      const provider = LockProviderFactory.getProvider(existing.device.provider);
      await provider.updateAccessCode(existing.externalCodeId, {
        code: codeChanged ? refreshed.code : undefined,
        name: nameChanged ? refreshed.codeName : undefined,
      });
      refreshed.errorMessage = null;
    } catch (error: any) {
      // Persist the failure so the UI can surface a warning; don't roll back
      // the DB update — the operator can retry via a delete+recreate.
      refreshed.errorMessage = `Provider update failed: ${error?.message || "unknown error"}`;
      logger.error(`Failed to propagate access-code update ${id} to provider:`, error);
    }
    return await this.accessCodeRepository.save(refreshed);
  }

  /**
   * Get scheduled access codes for today's check-in date
   * Used by the daily 5 AM EST job
   */
  async getScheduledCodesForToday(): Promise<AccessCode[]> {
    // Get today's date in EST timezone
    const estNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const today = new Date(estNow);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    logger.info(`Finding scheduled codes for today: ${today.toISOString()} to ${tomorrow.toISOString()}`);

    return await this.accessCodeRepository
      .createQueryBuilder("ac")
      .leftJoinAndSelect("ac.device", "device")
      .where("ac.status = :status", { status: AccessCodeStatus.SCHEDULED })
      .andWhere("ac.checkInDate >= :today", { today })
      .andWhere("ac.checkInDate < :tomorrow", { tomorrow })
      .getMany();
  }

  /**
   * Process scheduled access codes for today (called by daily 5 AM EST scheduler)
   * Sets access codes on devices with proper validity based on listing times and settings
   */
  async processScheduledCodes(): Promise<{ processed: number; failed: number; }> {
    logger.info("Starting daily access code processing job...");

    const scheduledCodes = await this.getScheduledCodesForToday();

    logger.info(`Found ${scheduledCodes.length} access codes scheduled for today`);

    let processed = 0;
    let failed = 0;

    for (const code of scheduledCodes) {
      try {
        logger.info(`Processing code ${code.id} for guest: ${code.guestName}, check-in: ${code.checkInDate}`);
        await this.setAccessCodeOnDevice(code.id);
        processed++;
      } catch (error) {
        failed++;
        logger.error(`Failed to process scheduled code ${code.id}:`, error);
      }
    }

    logger.info(`Daily access code processing completed: ${processed} set successfully, ${failed} failed`);

    return { processed, failed };
  }
}

