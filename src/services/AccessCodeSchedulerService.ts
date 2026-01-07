import { appDatabase } from "../utils/database.util";
import { AccessCode, AccessCodeStatus, AccessCodeSource } from "../entity/AccessCode";
import { PropertyLockSettings } from "../entity/PropertyLockSettings";
import { PropertyDevice } from "../entity/PropertyDevice";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { SmartLockAccessCodeService } from "./SmartLockAccessCodeService";
import logger from "../utils/logger.utils";
import { In, MoreThanOrEqual, LessThanOrEqual } from "typeorm";

/**
 * Access Code Scheduler Service
 * Handles automated access code generation for upcoming reservations
 */
export class AccessCodeSchedulerService {
  private settingsRepository = appDatabase.getRepository(PropertyLockSettings);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private listingRepository = appDatabase.getRepository(Listing);
  private reservationRepository = appDatabase.getRepository(ReservationInfoEntity);
  private accessCodeRepository = appDatabase.getRepository(AccessCode);
  private accessCodeService = new SmartLockAccessCodeService();

  /**
   * Process automated access code generation
   * Runs daily at 4 AM EST
   * Creates access codes for reservations with check-ins till next week
   */
  async processAutomatedAccessCodes(): Promise<{
    processed: number;
    skipped: number;
    failed: number;
  }> {
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    try {
      logger.info("Starting automated access code generation...");

      // 1. Get all unique property IDs that have device mappings
      const mappedPropertyDevices = await this.propertyDeviceRepository.find({
        where: { isActive: true },
        select: ["propertyId"],
      });

      const uniquePropertyIds = [...new Set(mappedPropertyDevices.map(pd => pd.propertyId))];
      logger.info(`Found ${uniquePropertyIds.length} properties with mapped devices`);

      if (uniquePropertyIds.length === 0) {
        return { processed, skipped, failed };
      }

      // 2. Get settings for all mapped properties
      const allSettings = await this.settingsRepository.find({
        where: { propertyId: In(uniquePropertyIds) },
      });

      // Filter to only properties with autoGenerateCodes enabled
      const enabledSettings = allSettings.filter(s => s.autoGenerateCodes);
      const enabledPropertyIds = enabledSettings.map(s => s.propertyId);

      logger.info(`${enabledSettings.length} properties have auto-generate enabled`);

      if (enabledPropertyIds.length === 0) {
        logger.info("No properties have auto-generate enabled. Skipping.");
        return { processed, skipped, failed };
      }

      // 3. Get reservations with check-ins till next week
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(23, 59, 59, 999);

      const reservations = await this.reservationRepository.find({
        where: {
          listingMapId: In(enabledPropertyIds),
          arrivalDate: MoreThanOrEqual(today),
          status: In(["new", "accepted", "modified", "moved"]), // Active reservations only
        },
      });

      // Filter reservations to only those within the next week
      const upcomingReservations = reservations.filter(r => {
        const arrivalDate = new Date(r.arrivalDate);
        return arrivalDate <= nextWeek;
      });

      logger.info(`Found ${upcomingReservations.length} upcoming reservations (check-ins till next week)`);

      // 4. Process each reservation
      for (const reservation of upcomingReservations) {
        try {
          const propertyId = reservation.listingMapId;
          
          // Get listing for timezone and check-in/check-out times
          const listing = await this.listingRepository.findOne({
            where: { id: propertyId },
          });

          // Check if access code already exists for this reservation
          const existingCodes = await this.accessCodeRepository.find({
            where: { reservationId: reservation.id },
          });

          if (existingCodes.length > 0) {
            logger.debug(`Skipping reservation ${reservation.id} - access code already exists`);
            skipped++;
            continue;
          }

          // Calculate check-in time (from listing or fallback to midnight)
          const checkInTime = listing?.checkInTimeStart ?? 0; // Fallback: 12 AM (midnight)
          
          // Calculate check-out time (from listing or fallback to 11 PM)
          const checkOutTime = listing?.checkOutTime ?? 23; // Fallback: 11 PM

          // Create access codes for this reservation
          const codes = await this.accessCodeService.createAccessCodesForReservation({
            reservationId: reservation.id,
            propertyId: propertyId,
            guestName: reservation.guestName,
            guestPhone: reservation.phone,
            checkInDate: new Date(reservation.arrivalDate),
            checkOutDate: reservation.departureDate ? new Date(reservation.departureDate) : undefined,
            checkInTime,
            checkOutTime,
            source: AccessCodeSource.AUTOMATIC,
          });

          if (codes.length > 0) {
            processed++;
            logger.info(`Created ${codes.length} access code(s) for reservation ${reservation.id} (guest: ${reservation.guestName})`);
          } else {
            // No codes created (possibly no devices mapped)
            skipped++;
          }
        } catch (error: any) {
          failed++;
          logger.error(`Failed to create access codes for reservation ${reservation.id}:`, error);
        }
      }

      logger.info(`Automated access code generation completed: ${processed} processed, ${skipped} skipped, ${failed} failed`);
    } catch (error: any) {
      logger.error("Error in automated access code generation:", error);
      throw error;
    }

    return { processed, skipped, failed };
  }

  /**
   * Generate access code name
   * Format: "Guest Name - Checkin Date - Checkout Date"
   */
  private generateCodeName(
    guestName: string,
    checkInDate: Date,
    checkOutDate: Date
  ): string {
    const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${guestName} - ${formatDate(checkInDate)} - ${formatDate(checkOutDate)}`;
  }
}
