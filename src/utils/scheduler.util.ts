
export function scheduleGetReservation() {
    const schedule = require('node-schedule');
    schedule.scheduleJob('*/5 * * * *', function () {
        console.log("Application is working: " + new Date())
    });
}