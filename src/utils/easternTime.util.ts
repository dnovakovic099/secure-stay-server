export const EASTERN_TIME_ZONE = "America/New_York";

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
