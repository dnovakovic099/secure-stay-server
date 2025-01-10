import { sendCodes } from "../scripts/sendCodes";
import { checkUnasweredMessages } from "../scripts/notifyAdmin"

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  schedule.scheduleJob("0 0 * * *", sendCodes);

  schedule.scheduleJob("*/1 * * * *", checkUnasweredMessages);
}
