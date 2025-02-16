import { sendCodes } from "../scripts/sendCodes";
import { checkForUnresolvedReviews, checkUnasweredMessages } from "../scripts/notifyAdmin";
import { syncReviews } from "../scripts/syncReview";
import { syncIssue } from "../scripts/syncIssue";

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  schedule.scheduleJob("0 0 * * *", sendCodes);

  schedule.scheduleJob("*/1 * * * *", checkUnasweredMessages);

  schedule.scheduleJob("0 9 * * *", checkForUnresolvedReviews);

  schedule.scheduleJob("0 * * * *", syncReviews);

  schedule.scheduleJob("0 * * * *", syncIssue);
}
