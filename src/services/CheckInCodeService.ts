import { appDatabase } from "../utils/database.util";
import { AccessCode, AccessCodeStatus, AccessCodeSource } from "../entity/AccessCode";
import { PropertyLockSettings } from "../entity/PropertyLockSettings";
import { PropertyDevice } from "../entity/PropertyDevice";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { SmartLockAccessCodeService, primaryPhoneLastFour } from "./SmartLockAccessCodeService";
import logger from "../utils/logger.utils";

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Guards against a sweep overlapping itself. Programming a lock takes seconds
 * and a heavy arrival day can outlast the sweep interval; two passes running at
 * once would both see the same `scheduled` rows and put duplicate passcodes on
 * the door.
 */
let sweepInProgress = false;

/**
 * How many times the sweep will re-attempt a lock that keeps refusing a code
 * before it stops and leaves it for a human. Without this the 15-minute sweep
 * retries the same dead lock every 15 minutes forever.
 */
const MAX_PUSH_ATTEMPTS = 6;

/**
 * Failures that will never succeed on retry: the lock has no gateway, has
 * remote programming switched off, doesn't support passcodes at all, or the
 * provider credentials are dead. Retrying these burns API quota and buries the
 * transient failures that are actually worth another attempt.
 */
function isPermanentLockFailure(message?: string | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("no gateway connected") ||
    m.includes("remote passcode setting disabled") ||
    m.includes("function is not supported") ||
    m.includes("status code 401") ||
    m.includes("permission denied")
  );
}

/**
 * Statuses that represent a booking a guest will actually show up for.
 * Mirrors AccessCodeSchedulerService so the nightly job and the live webhook
 * path never disagree about whether a reservation deserves a code.
 */
export const ACTIVE_RESERVATION_STATUSES = ["new", "accepted", "modified", "moved"];

export type CheckInCodeOutcome =
  /** Code exists and is live on every mapped lock. */
  | "pushed"
  /** Check-in is in the future; DB records created, the daily push job will program the locks. */
  | "scheduled"
  /** Nothing to do — not same-day, auto-generate off, no locks, cancelled, etc. */
  | "skipped"
  /** At least one lock rejected the code. */
  | "failed";

export interface CheckInCodeResult {
  reservationId: number;
  propertyId: number | null;
  outcome: CheckInCodeOutcome;
  reason?: string;
  /** The PIN the guest will use, once one has been derived. */
  code?: string;
  /** True when `code` is the last 4 of the guest's phone rather than a fallback. */
  codeFromPhone?: boolean;
  arrivalDate?: string | null;
  timezone?: string;
  isSameDay?: boolean;
  codesCreated: number;
  codesPushed: number;
  codesFailed: number;
  /** Per-lock failure messages, so a caller can show why a door wasn't programmed. */
  errors?: string[];
}

export interface EnsureCodesOptions {
  /** Free-text label recorded in logs, e.g. "hostify_webhook" or "sweep". */
  trigger?: string;
  /**
   * Only act when check-in is today in the property's timezone. Used by the
   * webhook and the recurring sweep so they never mass-create future codes.
   */
  onlySameDay?: boolean;
  /** Ignore the property's autoGenerateCodes switch. Operator-initiated runs only. */
  force?: boolean;
  /** Report what would happen without writing records or touching locks. */
  dryRun?: boolean;
}

/**
 * TypeORM hands back MariaDB DATE columns as "YYYY-MM-DD" strings even though
 * the entity types them as Date, and other call sites hydrate them into real
 * Dates. Normalize both into a plain calendar date.
 */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * The calendar date it is *right now* at the property. "Checking in today" is
 * meaningless in server time once the fleet spans more than one timezone — a
 * 9 PM Pacific booking is already tomorrow in New York.
 */
export function todayInZone(timeZone: string): string {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    logger.warn(`[CheckInCodes] Unknown timezone "${timeZone}", falling back to ${DEFAULT_TIMEZONE}`);
    zone = DEFAULT_TIMEZONE;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar date N days from now in UTC, used to bound the reservation query. */
function utcDateOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Check-in code brain.
 *
 * One idempotent entry point — `ensureCodesForReservation` — decides whether a
 * reservation needs a door code and programs every lock mapped to its property.
 * Everything else (the daily sweep, the Hostify webhook, the manual admin
 * route) is a thin caller of it, so a guest can never get a different result
 * depending on which trigger fired first.
 */
export class CheckInCodeService {
  private reservationRepository = appDatabase.getRepository(ReservationInfoEntity);
  private propertyDeviceRepository = appDatabase.getRepository(PropertyDevice);
  private settingsRepository = appDatabase.getRepository(PropertyLockSettings);
  private listingRepository = appDatabase.getRepository(Listing);
  private accessCodeService = new SmartLockAccessCodeService();

  /**
   * Make sure a reservation has a door code, and push it to the locks if the
   * guest arrives today.
   *
   * Safe to call repeatedly: code records are keyed on (reservation, device)
   * and locks that are already programmed are left alone.
   */
  async ensureCodesForReservation(
    reservationId: number,
    options: EnsureCodesOptions = {}
  ): Promise<CheckInCodeResult> {
    const { trigger = "manual", onlySameDay = false, force = false, dryRun = false } = options;
    const tag = `[CheckInCodes:${trigger}] reservation ${reservationId}`;

    const skip = (reason: string, extra: Partial<CheckInCodeResult> = {}): CheckInCodeResult => {
      logger.info(`${tag} skipped: ${reason}`);
      return {
        reservationId,
        propertyId: null,
        outcome: "skipped",
        reason,
        codesCreated: 0,
        codesPushed: 0,
        codesFailed: 0,
        ...extra,
      };
    };

    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) return skip("reservation_not_found");

    const propertyId = reservation.listingMapId;
    if (!propertyId) return skip("reservation_has_no_listing");

    if (!ACTIVE_RESERVATION_STATUSES.includes(String(reservation.status))) {
      return skip(`reservation_status_${reservation.status}`, { propertyId });
    }

    const arrivalDate = toDateOnly(reservation.arrivalDate);
    if (!arrivalDate) return skip("reservation_has_no_arrival_date", { propertyId });

    const listing = await this.listingRepository.findOne({ where: { id: propertyId } });
    const timezone = listing?.timeZoneName || DEFAULT_TIMEZONE;
    const isSameDay = arrivalDate === todayInZone(timezone);
    const context = { propertyId, arrivalDate, timezone, isSameDay };

    if (onlySameDay && !isSameDay) {
      return skip("not_checking_in_today", context);
    }

    // A property with no lock, or with auto-generate deliberately switched off,
    // is managed by hand. Programming it anyway would overwrite whatever the
    // operator set on the door.
    const deviceCount = await this.propertyDeviceRepository.count({
      where: { propertyId, isActive: true },
    });
    if (deviceCount === 0) return skip("no_locks_mapped_to_property", context);

    const settings = await this.accessCodeService.getOrCreateSettings(propertyId);
    if (!settings.autoGenerateCodes && !force) {
      return skip("auto_generate_disabled", context);
    }

    const phoneLastFour = primaryPhoneLastFour(reservation.phone);
    if (!phoneLastFour) {
      logger.warn(
        `${tag} has no usable phone number ("${reservation.phone ?? ""}"); falling back to a generated code`
      );
    }

    if (dryRun) {
      const previewCode = this.accessCodeService.generateAccessCode(reservation.phone ?? null, settings);
      return {
        reservationId,
        outcome: isSameDay ? "pushed" : "scheduled",
        reason: "dry_run",
        code: previewCode,
        codeFromPhone: previewCode === phoneLastFour,
        codesCreated: deviceCount,
        codesPushed: isSameDay ? deviceCount : 0,
        codesFailed: 0,
        ...context,
      };
    }

    // Deliberately pass the listing hours through as undefined when unset so
    // createAccessCodesForReservation applies its own 3 PM / 11 AM defaults.
    // Substituting midnight here would backdate the code's activation window.
    const codes = await this.accessCodeService.createAccessCodesForReservation({
      reservationId: reservation.id,
      propertyId,
      guestName: reservation.guestName,
      guestPhone: reservation.phone,
      checkInDate: new Date(arrivalDate),
      checkOutDate: toDateOnly(reservation.departureDate)
        ? new Date(toDateOnly(reservation.departureDate) as string)
        : undefined,
      checkInTime: listing?.checkInTimeStart ?? undefined,
      checkOutTime: listing?.checkOutTime ?? undefined,
      source: AccessCodeSource.AUTOMATIC,
    });

    const code = codes[0]?.code;
    const base: CheckInCodeResult = {
      reservationId,
      outcome: "scheduled",
      code,
      codeFromPhone: Boolean(phoneLastFour) && code === phoneLastFour,
      codesCreated: codes.length,
      codesPushed: 0,
      codesFailed: 0,
      ...context,
    };

    if (!codes.length) {
      return skip("no_codes_created", context);
    }

    // Future arrivals are left in `scheduled`; the 7 AM job programs them on the
    // morning of check-in so the code isn't live on the door for days first.
    if (!isSameDay) {
      logger.info(
        `${tag} arrives ${arrivalDate} (${timezone}); ${codes.length} code(s) scheduled, not pushed yet`
      );
      return base;
    }

    const errors: string[] = [];
    let pushed = 0;
    let failed = 0;

    for (const record of codes) {
      if (record.status === AccessCodeStatus.SET) {
        pushed++;
        continue;
      }

      // Stop re-attempting locks that cannot accept a code. These still count
      // as failures so the guest's situation stays visible, but we quit
      // hammering the provider every 15 minutes over something only a person
      // standing at the door (or a credential fix) can resolve.
      if (record.status === AccessCodeStatus.FAILED) {
        const permanent = isPermanentLockFailure(record.errorMessage);
        const exhausted = (record.attemptCount || 0) >= MAX_PUSH_ATTEMPTS;
        if (permanent || exhausted) {
          failed++;
          errors.push(
            `Lock ${record.deviceId} needs manual attention: ${record.errorMessage || "repeated failures"}`
          );
          continue;
        }
      }

      try {
        const updated = await this.accessCodeService.setAccessCodeOnDevice(record.id);
        // setAccessCodeOnDevice records provider errors on the row instead of
        // throwing, so the status is the only reliable success signal.
        if (updated.status === AccessCodeStatus.SET) {
          pushed++;
        } else {
          failed++;
          errors.push(updated.errorMessage || `Lock ${record.deviceId} rejected the code`);
        }
      } catch (error: any) {
        failed++;
        errors.push(error?.message || `Lock ${record.deviceId} failed`);
        logger.error(`${tag} failed pushing code ${record.id}:`, error);
      }
    }

    logger.info(
      `${tag} same-day check-in: code ${code} pushed to ${pushed}/${codes.length} lock(s), ${failed} failed`
    );

    return {
      ...base,
      outcome: failed > 0 ? "failed" : "pushed",
      codesPushed: pushed,
      codesFailed: failed,
      errors: errors.length ? errors : undefined,
    };
  }

  /**
   * Program codes for every guest checking in today.
   *
   * Runs on a short interval rather than once a day: same-day bookings arrive
   * at any hour, and this is the safety net for reservations that landed via
   * the nightly PMS sync instead of a webhook, plus a retry for locks that were
   * offline earlier.
   */
  async processTodaysCheckIns(options: { force?: boolean; dryRun?: boolean } = {}): Promise<{
    checked: number;
    pushed: number;
    scheduled: number;
    skipped: number;
    failed: number;
    results: CheckInCodeResult[];
  }> {
    const summary = { checked: 0, pushed: 0, scheduled: 0, skipped: 0, failed: 0, results: [] as CheckInCodeResult[] };

    if (sweepInProgress) {
      logger.warn("[CheckInCodes:sweep] Previous sweep still running, skipping this pass");
      return summary;
    }
    sweepInProgress = true;
    try {
      return await this.runTodaysCheckIns(summary, options);
    } finally {
      sweepInProgress = false;
    }
  }

  private async runTodaysCheckIns(
    summary: {
      checked: number;
      pushed: number;
      scheduled: number;
      skipped: number;
      failed: number;
      results: CheckInCodeResult[];
    },
    options: { force?: boolean; dryRun?: boolean }
  ) {
    const mappedProperties = await this.propertyDeviceRepository.find({
      where: { isActive: true },
      select: ["propertyId"],
    });
    const mappedPropertyIds = [...new Set(mappedProperties.map((pd) => pd.propertyId))];
    if (!mappedPropertyIds.length) {
      logger.info("[CheckInCodes:sweep] No properties have locks mapped");
      return summary;
    }

    let propertyIds = mappedPropertyIds;
    if (!options.force) {
      const allSettings = await this.settingsRepository.find();
      const enabled = new Set(
        allSettings.filter((s) => s.autoGenerateCodes).map((s) => s.propertyId)
      );
      propertyIds = mappedPropertyIds.filter((id) => enabled.has(id));
    }

    if (!propertyIds.length) {
      logger.info("[CheckInCodes:sweep] No properties have auto-generate enabled");
      return summary;
    }

    // Query a ±1 day window in UTC because "today" differs per property
    // timezone; ensureCodesForReservation then does the exact per-property
    // comparison and skips anything that isn't actually arriving today.
    const reservations = await this.reservationRepository
      .createQueryBuilder("r")
      .where("r.listingMapId IN (:...propertyIds)", { propertyIds })
      .andWhere("r.status IN (:...statuses)", { statuses: ACTIVE_RESERVATION_STATUSES })
      .andWhere("r.arrivalDate BETWEEN :from AND :to", {
        from: utcDateOffset(-1),
        to: utcDateOffset(1),
      })
      .getMany();

    logger.info(
      `[CheckInCodes:sweep] Evaluating ${reservations.length} reservation(s) across ${propertyIds.length} property(ies)`
    );

    for (const reservation of reservations) {
      try {
        const result = await this.ensureCodesForReservation(reservation.id, {
          trigger: "sweep",
          onlySameDay: true,
          force: options.force,
          dryRun: options.dryRun,
        });
        summary.checked++;
        summary[result.outcome]++;
        // Only surface reservations we actually acted on; a sweep that skips
        // 200 future bookings shouldn't bury the three that mattered.
        if (result.outcome !== "skipped") summary.results.push(result);
      } catch (error: any) {
        summary.failed++;
        logger.error(`[CheckInCodes:sweep] Reservation ${reservation.id} threw:`, error);
      }
    }

    logger.info(
      `[CheckInCodes:sweep] Done: ${summary.pushed} pushed, ${summary.scheduled} scheduled, ${summary.failed} failed, ${summary.skipped} skipped`
    );

    return summary;
  }

  /**
   * Webhook entry point. Never throws and never rejects — a lock that refuses a
   * code must not turn into a non-2xx response that makes Hostify retry the
   * whole reservation event.
   */
  async handleReservationUpserted(
    reservationId: number,
    trigger = "hostify_webhook"
  ): Promise<CheckInCodeResult | null> {
    try {
      return await this.ensureCodesForReservation(reservationId, {
        trigger,
        onlySameDay: true,
      });
    } catch (error: any) {
      logger.error(
        `[CheckInCodes:${trigger}] Unhandled error for reservation ${reservationId}: ${error?.message}`,
        error
      );
      return null;
    }
  }
}
