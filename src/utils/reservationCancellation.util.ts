import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";

export const isCancelledStatus = (status: unknown) =>
  String(status || "").trim().toLowerCase() === "cancelled";

export const getReservationDateKey = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  const parsed = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const parseHour = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(23, Math.floor(value)));
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : null;
};

const getLocalSnapshot = (date: Date, timeZoneName: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const hour = Number(read("hour")) % 24;
  const minute = Number(read("minute"));

  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: hour * 60 + minute,
  };
};

export const isCancelledAfterListingLocalCheckIn = (
  reservation: Pick<ReservationInfoEntity, "arrivalDate" | "checkInTime" | "status">,
  listing?: Pick<Listing, "timeZoneName" | "checkInTimeStart"> | null,
  cancelledAt: Date = new Date(),
) => {
  if (!isCancelledStatus(reservation.status)) return false;

  const arrivalDate = getReservationDateKey(reservation.arrivalDate);
  if (!arrivalDate) return false;

  const timeZoneName = listing?.timeZoneName?.trim() || "America/New_York";
  const checkInHour = parseHour(reservation.checkInTime) ?? parseHour(listing?.checkInTimeStart) ?? 15;
  const cancellationLocal = getLocalSnapshot(cancelledAt, timeZoneName);
  const checkInMinutes = checkInHour * 60;

  if (cancellationLocal.date > arrivalDate) return true;
  if (cancellationLocal.date < arrivalDate) return false;
  return cancellationLocal.minutes >= checkInMinutes;
};
