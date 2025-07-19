import { format } from "date-fns";

export function getCurrentDateInUTC(){
  // Get the current date in UTC
  const currentDate = new Date();

  // Convert the current date to UTC
  const utcYear = currentDate.getUTCFullYear();
  const utcMonth = currentDate.getUTCMonth() + 1; // Months are zero indexed, so we add 1
  const utcDay = currentDate.getUTCDate();
  const utcHours = currentDate.getUTCHours();
  const utcMinutes = currentDate.getUTCMinutes();
  const utcSeconds = currentDate.getUTCSeconds();

  // You can format the date as needed
  const utcCurrentDate = utcYear + "-" + utcMonth + "-" + utcDay;
  return utcCurrentDate
}

export function getTimestamp(dateString: string, hours: number, minutes: number, seconds: number) {
  // Parse the date string
  let [year, month, day] = dateString.split('-').map(Number);
  month -= 1;

  const dateTime = new Date(year, month, day, hours, minutes, seconds);

  const timestamp = dateTime.getTime();
  return timestamp;
}

export function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}

export function formatDate(dateString: string) {
  // Parse the input date string
  const date = new Date(dateString);

  // Define an array of month names
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Extract the month, day, and year
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  // Return the formatted date
  return `${month} ${day}, ${year}`;
}

export function getReservationDaysInRange(
  fromDate: any,
  toDate: any,
  reservationStartDate: any,
  reservationEndDate: any
): number {
  // Convert strings to Date objects
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const reservationStart = new Date(reservationStartDate);
  const reservationEnd = new Date(reservationEndDate);

  // Validate the date objects
  if (
    isNaN(from.getTime()) ||
    isNaN(to.getTime()) ||
    isNaN(reservationStart.getTime()) ||
    isNaN(reservationEnd.getTime())
  ) {
    throw new Error("Invalid date format. Please use 'yyyy-mm-dd'.");
  }

  // Adjust the reservation end date to exclude the check-out day
  const adjustedReservationEnd = new Date(reservationEnd.getTime() - 24 * 60 * 60 * 1000);

  // If the adjusted reservation end date is before the fromDate, it doesn't overlap
  if (adjustedReservationEnd < from) {
    return 0;
  }

  // Find the overlap between the reservation period (adjusted) and the date range
  const overlapStart = new Date(Math.max(from.getTime(), reservationStart.getTime()));
  const overlapEnd = new Date(Math.min(to.getTime(), adjustedReservationEnd.getTime()));

  // If there is no overlap, return 0
  if (overlapStart > overlapEnd) {
    return 0;
  }

  // Calculate the number of nights in the overlap period
  const diffInMilliseconds = overlapEnd.getTime() - overlapStart.getTime() + 1;
  return Math.ceil(diffInMilliseconds / (1000 * 60 * 60 * 24));
}


export const getFormattedUTCDateTime = (): string => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0"); // Months are 0-based
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
};

export const isSameOrAfterDate = (dateToCheck: string, referenceDate: string): boolean => {
  const normalize = (dateStr: string): Date => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  return normalize(dateToCheck) >= normalize(referenceDate);
}


export function getStartOfThreeMonthsAgo() {
  const today = new Date();

  // Move back 2 months because we want the starting month of the 3rd month before
  today.setMonth(today.getMonth() - 2);

  // Set the date to the 1st
  today.setDate(1);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = '01'; // Always 1st day

  return `${year}-${month}-${day}`;
}

export function getDatesBetween(start: Date, end: Date): string[] {
  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(format(current, "yyyy-MM-dd"));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function getLast7DaysDate(inputDateStr: string) {
  const inputDate = new Date(inputDateStr);

  // Subtract 6 days (to include the input date as day 1)
  const pastDate = new Date(inputDate.getTime() - 6 * 24 * 60 * 60 * 1000);

  const yyyy = pastDate.getFullYear();
  const mm = String(pastDate.getMonth() + 1).padStart(2, '0');
  const dd = String(pastDate.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

export function getPreviousMonthRange(currentDateStr: string): { firstDate: string; lastDate: string; } {
  const currentDate = new Date(currentDateStr);

  if (isNaN(currentDate.getTime())) {
    throw new Error("Invalid date format. Use yyyy-mm-dd.");
  }

  // Go to the 1st of the current month
  const firstDayCurrentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

  // Get last day of previous month by subtracting 1 day in milliseconds
  const lastDayPrevMonth = new Date(firstDayCurrentMonth.getTime() - 1);

  // First day of previous month
  const firstDayPrevMonth = new Date(lastDayPrevMonth.getFullYear(), lastDayPrevMonth.getMonth(), 1);

  const formatDate = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  return {
    firstDate: formatDate(firstDayPrevMonth),
    lastDate: formatDate(lastDayPrevMonth)
  };
}

export function convertLocalHourToUTC(localHour: number, timeZoneName: string) {
  const now = new Date();
  now.setHours(localHour, 0, 0, 0);

  const zonedTime = new Date(
    now.toLocaleString('en-US', { timeZone: timeZoneName })
  );

  const utcHour = zonedTime.getUTCHours();

  return utcHour;
}








