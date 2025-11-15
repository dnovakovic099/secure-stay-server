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
import { MaintenanceService } from "../services/MaintenanceService";
import { PublishedStatementService } from "../services/PublishedStatementService";
import { ReviewService } from "../services/ReviewService";
import { ExpenseService } from "../services/ExpenseService";
import { updateListingId } from "../scripts/updateListingId";

export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  // schedule.scheduleJob("0 0 * * *", sendCodes);

  // schedule.scheduleJob("*/5 * * * *", checkUnasweredMessages);

  schedule.scheduleJob("0 9 * * *", checkForUnresolvedReviews);

  // schedule.scheduleJob("0 * * * *", syncReviews);

  schedule.scheduleJob({ hour: 9, minute: 0, dayOfWeek: 1, tz: "America/New_York" }, syncIssue); // Every Monday at 9 AM EST

  schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, checkUpdatedReviews);

  schedule.scheduleJob("0 14 * * *", checkForPendingRefundRequest);

  schedule.scheduleJob({ hour: 4, minute: 30, tz: "America/New_York" }, syncReservation);

  // schedule.scheduleJob({ hour: 4, minute: 52, tz: "America/New_York" }, syncCurrentlyStayingReservations);

  // schedule.scheduleJob({ hour: 1, minute: 0, tz: "America/New_York" }, syncHostawayUser);

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
    "0 * * * *", // every hour
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

  schedule.scheduleJob(
    { hour: 2, minute: 0, tz: "America/New_York" },  // Daily at 2 AM EST
    async () => {
      try {
        logger.info('Processing maintenance log creation...');
        const maintenanceService = new MaintenanceService();
        await maintenanceService.automateMaintenanceLogs();
        logger.info('Processed maintenance log creation successfully.');
      } catch (error) {
        logger.error("Error processing maintenance log creation:", error);
      }
    });

  // schedule.scheduleJob("0 * * * *", async () => {
  //   try {
  //     logger.info('Checking for new published statements from HostAway...');
  //     const publishedStatementService = new PublishedStatementService();
  //     await publishedStatementService.savePublishedStatement();
  //     logger.info('Checked for new published statements from HostAway successfully.');
  //   } catch (error) {
  //     logger.error("Error checking for new published statements from HostAway:", error);
  //   }
  // });

  // schedule.scheduleJob({ hour: 5, minute: 18, tz: "America/New_York" },  async () => {
  //   try {
  //     logger.info('Syncing published statements from HostAway...');
  //     const publishedStatementService = new PublishedStatementService();
  //     await publishedStatementService.syncPublishedStatements();
  //     logger.info('Synced published statements from HostAway successfully.');
  //   } catch (error) {
  //     logger.error("Error syncing published statements from HostAway", error);
  //   }
  // });

  schedule.scheduleJob(
    { hour: 6, minute: 0, tz: "America/New_York" }, // 1st day of the month at 1 AM EST
    async () => {
      try {
        logger.info('Scheduled task for deleting reservation logs older than last month ran...');
        const reservationInfoService = new ReservationInfoService();
        await reservationInfoService.deleteReservationLogsOlderThanlastMonth();
      } catch (error) {
        logger.error(error);
      }
    }
  );

  schedule.scheduleJob(
    "0 * * * *", // every hour
    async () => {
      try {
        logger.info('Scheduled task for processing review checkout ran...');
        const reviewService = new ReviewService();
        await reviewService.processReviewCheckout();
        logger.info('Scheduled task for processing review checkout completed...');
      } catch (error) {
        logger.error(error);
      }
    }
  );

  schedule.scheduleJob(
    { hour: 8, minute: 50, tz: "America/New_York" },
    async () => {
      try {
        logger.info('Scheduled task for processing recurring expenses ran...');
        const expenseService = new ExpenseService();
        await expenseService.processRecurringExpenses();
        logger.info('Scheduled task for processing recurring expenses completed...');
      } catch (error) {
        logger.error(error);
      }
    }
  );

  schedule.scheduleJob(
    { hour: 4, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info('Scheduled task for deleting launch status review checkout ran...');
        const reviewService = new ReviewService();
        await reviewService.deleteLaunchReviewCheckouts();
        logger.info('Scheduled task for deleting launch status review checkout completed...');
      } catch (error) {
        logger.error(error);
      }
    }
  );

  schedule.scheduleJob(
    { hour: 9, minute: 0, tz: "America/New_York" }, // 9 AM EST daily
    async () => {
      try {
        logger.info('Scheduled task for processing bad review ran...');
        const reviewService = new ReviewService();
        await reviewService.updateBadReviewStatusForCallPhaseDaily();
        logger.info('Scheduled task for processing bad review completed...');
      } catch (error) {
        logger.error("Scheduled task for bad review:", error);
      }
    })

  schedule.scheduleJob(
    { hour: 3, minute: 10, tz: "America/New_York" },
    async () => {
      try {
        logger.info('Processing upsells to create missing extras in the system...');
        const currentDate = format(new Date(), 'yyyy-MM-dd');
        const upsellOrderService = new UpsellOrderService();
        await upsellOrderService.scriptToCreateMissingExtrasFromUpsell(currentDate);
        logger.info('Processed upsells to create missing extras in the system successfully.');
      } catch (error) {
        logger.error("Error processing upsells to create missing extras in the system:", error);
      }
    })

  schedule.scheduleJob({ hour: 11, minute: 10, tz: "America/New_York" }, updateListingId);

}
