export function getCurrentDateInUTC() {
  // Get the current date in UTC
  var currentDate = new Date();

  // Convert the current date to UTC
  var utcYear = currentDate.getUTCFullYear();
  var utcMonth = currentDate.getUTCMonth() + 1; // Months are zero indexed, so we add 1
  var utcDay = currentDate.getUTCDate();
  var utcHours = currentDate.getUTCHours();
  var utcMinutes = currentDate.getUTCMinutes();
  var utcSeconds = currentDate.getUTCSeconds();

  // You can format the date as needed
  var utcCurrentDate = utcYear + "-" + utcMonth + "-" + utcDay;
  return utcCurrentDate;
}
