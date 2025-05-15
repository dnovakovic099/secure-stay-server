import { sendCodes } from "../scripts/sendCodes";
import { checkForPendingRefundRequest, checkForUnresolvedReviews, checkUnasweredMessages, checkUpdatedReviews } from "../scripts/notifyAdmin";
import { syncReviews } from "../scripts/syncReview";
import { syncIssue } from "../scripts/syncIssue";
import { syncReservation } from "../scripts/syncReservation";
import { syncHostawayUser } from "../scripts/syncHostawayUser";
import { OccupancyReportService } from "../services/OccupancyReportService";
import logger from "./logger.utils";

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  schedule.scheduleJob("0 0 * * *", sendCodes);

  schedule.scheduleJob("*/1 * * * *", checkUnasweredMessages);

  schedule.scheduleJob("0 9 * * *", checkForUnresolvedReviews);

  schedule.scheduleJob("0 * * * *", syncReviews);

  schedule.scheduleJob("0 14 * * 1", syncIssue);

  schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, checkUpdatedReviews);

  schedule.scheduleJob("0 14 * * *", checkForPendingRefundRequest);

  schedule.scheduleJob("0 * * * *", syncReservation);

  schedule.scheduleJob({ hour: 1, minute: 0, tz: "America/New_York" }, syncHostawayUser);

  // Schedule daily occupancy report at 8 AM EST
  schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, async () => {
    try {
      logger.info('SendDailyOccupancyReport scheduler ran...')
      const occupancyReportService = new OccupancyReportService();
      await occupancyReportService.sendDailyReport();
      logger.info('SendDailyOccupancyReport scheduler completed...')
    } catch (error) {
      logger.error("Error sending daily occupancy report:", error);
    }
  });
}
