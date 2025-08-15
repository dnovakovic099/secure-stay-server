import { sendCodes } from "../scripts/sendCodes";
import { checkForPendingRefundRequest, checkForUnresolvedReviews, checkUnasweredMessages, checkUpdatedReviews } from "../scripts/notifyAdmin";
import { syncReviews } from "../scripts/syncReview";
import { syncIssue } from "../scripts/syncIssue";
import { syncCurrentlyStayingReservations, syncReservation } from "../scripts/syncReservation";
import { syncHostawayUser } from "../scripts/syncHostawayUser";
import { OccupancyReportService } from "../services/OccupancyReportService";
import logger from "./logger.utils";
import { ReservationInfoService } from "../services/ReservationInfoService";
import { ListingService } from "../services/ListingService";
import { UpsellOrderService } from "../services/UpsellOrderService";
import { format } from "date-fns";
import { ClaimsService } from "../services/ClaimsService";

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  // schedule.scheduleJob("0 0 * * *", sendCodes);

  schedule.scheduleJob("*/5 * * * *", checkUnasweredMessages);

  schedule.scheduleJob("0 9 * * *", checkForUnresolvedReviews);

  schedule.scheduleJob("0 * * * *", syncReviews);

  schedule.scheduleJob("0 14 * * 1", syncIssue);

  schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, checkUpdatedReviews);

  schedule.scheduleJob("0 14 * * *", checkForPendingRefundRequest);

  // schedule.scheduleJob("0 * * * *", syncReservation);

  schedule.scheduleJob({ hour: 4, minute: 52, tz: "America/New_York" }, syncCurrentlyStayingReservations);

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

  schedule.scheduleJob(
    { hour: 1, minute: 0, dayOfWeek: 0, tz: "America/New_York" }, // Sunday @ 1 AM EST
    async () => {
      try {
        logger.info('Scheduled task for extended reservation weekly report ran...');
        const reservationInfoService = new ReservationInfoService();
        await reservationInfoService.processExtendedReservations("weekly");
      } catch (error) {
        logger.error("Error in scheduled task for extended reservation report:", error);
      }
    }
  );

  schedule.scheduleJob(
    { hour: 1, minute: 0, date: 1, tz: "America/New_York" }, // 1st day of the month at 1 AM EST
    async () => {
      try {
        logger.info('Scheduled task for extended reservation monthly report ran...');
        const reservationInfoService = new ReservationInfoService();
        await reservationInfoService.processExtendedReservations("monthly");
      } catch (error) {
        logger.error("Error in scheduled task for monthly extended reservation report:", error);
      }
    }
  );

  schedule.scheduleJob(
    { hour: 3, minute: 0, tz: "America/New_York" }, // Daily at 3 AM EST
    async () => {
      try {
        logger.info('Sync listings for all users ran...');
        const listingService = new ListingService();
        await listingService.autoSyncListings();
        logger.info('Sync listings for all users completed...');
      } catch (error) {
        logger.error("Error syncing listings for all users:", error);
      }
    })

  schedule.scheduleJob(
    { hour: 23, minute: 0, tz: "America/New_York" }, // Daily at 11 PM EST
    async () => {
      try {
        logger.info('Processing checkout date upsells to create extras in HostAway...');
        const currentDate = format(new Date(), 'yyyy-MM-dd');
        const upsellOrderService = new UpsellOrderService();
        await upsellOrderService.processCheckoutDateUpsells(currentDate);
        logger.info('Processed checkout date upsells successfully.');
      } catch (error) {
        logger.error("Error processing checkout date upsells:", error);
      }
    })

  schedule.scheduleJob(
    { hour: 8, minute: 0, tz: "America/New_York" }, // Daily at 8 AM EST
    async () => {
      try {
        logger.info('Send reminder message for pending claims...');
        const claimsService = new ClaimsService();
        await claimsService.sendReminderMessageForClaims();
        logger.info('Sent reminder message for pending claims successfully.');
      } catch (error) {
        logger.error("Error sending reminder message for pending claims", error);
      }
    });

  schedule.scheduleJob(
    { hour: 1, minute: 30, tz: "America/New_York" },  // Daily at 1:30 AM EST
    async () => {
      try {
        const reservationInfoService = new ReservationInfoService();
        await reservationInfoService.refreshCurrentYearReservationStatusReport();
      } catch (error) {
        logger.error("Error sending reminder message for pending claims", error);
      }
    });
}
