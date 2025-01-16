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
  fromDate: string,
  toDate: string,
  reservationStartDate: string,
  reservationEndDate: string
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


