export const EASTERN_TIME_ZONE = "America/New_York";

export const getEasternTimeZoneOffsetMs = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  const values = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value);
    return acc;
  }, {} as Record<string, number>);

  const normalizedHour = values.hour === 24 ? 0 : values.hour;
  const utcLikeTime = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    normalizedHour,
    values.minute,
    values.second
  );

  return utcLikeTime - (date.getTime() - date.getMilliseconds());
};

export const easternDateTimeToUtc = (
  dateString: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
) => {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const firstOffset = getEasternTimeZoneOffsetMs(utcGuess);
  const firstPass = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getEasternTimeZoneOffsetMs(firstPass);

  return new Date(utcGuess.getTime() - secondOffset);
};

export const getEasternTimestampRange = (fromDate: string, toDate: string) => ({
  start: easternDateTimeToUtc(fromDate, 0, 0, 0, 0),
  end: easternDateTimeToUtc(toDate, 23, 59, 59, 999),
});

export const getEasternDateString = (date: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new Error("Unable to resolve current Eastern date");
  }

  return `${year}-${month}-${day}`;
};
