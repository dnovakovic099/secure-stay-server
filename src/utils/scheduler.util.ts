import { sendCodes } from "../scripts/sendCodes";
import { checkForPendingRefundRequest, checkForUnresolvedReviews, checkUnasweredMessages, checkUnasweredMessagesHostify, checkUpdatedReviews } from "../scripts/notifyAdmin";
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
import { createExpenseLogsFromResolution } from "../scripts/createExpenseLogsFromResolution";
import { updateMgmtFee } from "../scripts/updateMgmtFee";
import { DatabaseBackupService } from "../services/DatabaseBackupService";
import { AccessCodeSchedulerService } from "../services/AccessCodeSchedulerService";
import { SmartLockAccessCodeService } from "../services/SmartLockAccessCodeService";
import { TimeEntryService } from "../services/TimeEntryService";
import { LatestBookingReportService } from "../services/LatestBookingReportService";
import { GuestAnalysisService } from "../services/GuestAnalysisService";
import { CleanerNotificationService } from "../services/CleanerNotificationService";
import { EscalationService } from "../services/EscalationService";
import { CheckInNotificationService } from "../services/CheckInNotificationService";
import { ResolutionsTeamSlackService } from "../services/ResolutionsTeamSlackService";
import { IssuesService } from "../services/IssuesService";
import { ClientService } from "../services/ClientService";
import { TurnoverService } from "../services/TurnoverService";
import sendSlackMessage from "./sendSlackMsg";
import OpenAI from "openai";
import { InboxAIAuditService } from "../services/InboxAIAuditService";
import { AutoMessageService } from "../services/AutoMessageService";
import { OverduePaymentService } from "../services/OverduePaymentService";
import { QuoInboxService } from "../services/QuoInboxService";
import { QuoItemDetectionService } from "../services/QuoItemDetectionService";


export function scheduleGetReservation() {
  const schedule = require("node-schedule");
  schedule.scheduleJob("*/5 * * * *", function () {
    console.log("Application is working: " + new Date());
  });

  // schedule.scheduleJob("0 0 * * *", sendCodes);

  // Hostaway unanswered messages (disabled)
  // schedule.scheduleJob("*/5 * * * *", checkUnasweredMessages);

  // Hostify unanswered messages - runs every 5 minutes
  schedule.scheduleJob("*/5 * * * *", checkUnasweredMessagesHostify);

  schedule.scheduleJob("0 9 * * *", checkForUnresolvedReviews);

  schedule.scheduleJob("0 * * * *", syncReviews);

  schedule.scheduleJob({ hour: 9, minute: 0, dayOfWeek: 1, tz: "America/New_York" }, syncIssue); // Every Monday at 9 AM EST

  schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, checkUpdatedReviews);

  schedule.scheduleJob("0 14 * * *", checkForPendingRefundRequest);

  schedule.scheduleJob({ hour: 2, minute: 15, tz: "America/New_York" }, syncReservation);

  // schedule.scheduleJob({ hour: 4, minute: 52, tz: "America/New_York" }, syncCurrentlyStayingReservations);

  // schedule.scheduleJob({ hour: 1, minute: 0, tz: "America/New_York" }, syncHostawayUser);

  // Schedule daily occupancy report at 8 AM EST
  // schedule.scheduleJob({ hour: 9, minute: 0, tz: "America/New_York" }, async () => {
  //   try {
  //     logger.info('SendDailyOccupancyReport scheduler ran...')
  //     const occupancyReportService = new OccupancyReportService();
  //     await occupancyReportService.sendDailyReport();
  //     logger.info('SendDailyOccupancyReport scheduler completed...')
  //   } catch (error) {
  //     logger.error("Error sending daily occupancy report:", error);
  //   }
  // });

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
    "0 * * * *", // every hour
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
        logger.info('Refreshing stale issue resolution notes...');
        const issuesService = new IssuesService();
        const result = await issuesService.refreshStaleResolutionAnalyses();
        logger.info(`Refreshed stale issue resolution notes. Checked: ${result.checked}, refreshed: ${result.refreshed}`);
      } catch (error) {
        logger.error("Error refreshing stale issue resolution notes", error);
      }
    });

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

  // Daily reconciliation safety net. The hourly task above looks back 7 days, which catches
  // most missed-row scenarios. This 03:10 Eastern job runs a wider 30-day backfill so any
  // reservation whose departureDate fell in the last month and never got a review_checkout
  // row gets caught here. processReviewCheckoutForDateRange is idempotent — it skips
  // reservations that already have a row. Running it once a day keeps the load light while
  // closing the loop on long-tail failure modes (extended downtime, edits to old
  // reservation records, time-zone edge cases, etc).
  schedule.scheduleJob(
    { hour: 3, minute: 10, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[ReviewCheckoutReconciliation] Daily 30-day reconciliation started');
        const reviewService = new ReviewService();
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 30);
        const startStr = start.toISOString().slice(0, 10);
        const endStr = today.toISOString().slice(0, 10);
        const result = await reviewService.processReviewCheckoutForDateRange(startStr, endStr);
        logger.info(`[ReviewCheckoutReconciliation] Daily 30-day reconciliation completed — created=${result.created} skipped=${result.skipped} errors=${result.errors}`);
      } catch (error) {
        logger.error('[ReviewCheckoutReconciliation] Daily reconciliation failed', error);
      }
    }
  );

  // Recurring Expense Scheduler - DISABLED
  // schedule.scheduleJob(
  //   { hour: 8, minute: 50, tz: "America/New_York" },
  //   async () => {
  //     try {
  //       logger.info('Scheduled task for processing recurring expenses ran...');
  //       const expenseService = new ExpenseService();
  //       await expenseService.processRecurringExpenses();
  //       logger.info('Scheduled task for processing recurring expenses completed...');
  //     } catch (error) {
  //       logger.error(error);
  //     }
  //   }
  // );

  // schedule.scheduleJob(
  //   { hour: 4, minute: 0, tz: "America/New_York" },
  //   async () => {
  //     try {
  //       logger.info('Scheduled task for deleting launch status review checkout ran...');
  //       const reviewService = new ReviewService();
  //       await reviewService.deleteLaunchReviewCheckouts();
  //       logger.info('Scheduled task for deleting launch status review checkout completed...');
  //     } catch (error) {
  //       logger.error(error);
  //     }
  //   }
  // );

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

  // schedule.scheduleJob(
  //   { hour: 14, minute: 0, tz: "America/New_York" },
  //   async () => {
  //     try {
  //       logger.info('Processing upsells to create missing extras in the system...');
  //       const currentDate = format(new Date(), 'yyyy-MM-dd');
  //       const upsellOrderService = new UpsellOrderService();
  //       await upsellOrderService.scriptToCreateMissingExtrasFromUpsell(currentDate);
  //       logger.info('Processed upsells to create missing extras in the system successfully.');
  //     } catch (error) {
  //       logger.error("Error processing upsells to create missing extras in the system:", error);
  //     }
  //   })

  // schedule.scheduleJob({ hour: 13, minute: 15, tz: "America/New_York" }, updateListingId);

  schedule.scheduleJob({ hour: 13, minute: 17, tz: "America/New_York" }, createExpenseLogsFromResolution);

  // schedule.scheduleJob({ hour: 13, minute: 19, tz: "America/New_York" }, updateMgmtFee);

  // Tech Fee Expense Automation
  // December 30, 2025 at 8 AM EST (one-time)
  // schedule.scheduleJob({ year: 2025, month: 11, date: 30, hour: 8, minute: 0, tz: "America/New_York" }, async () => {
  //   try {
  //     logger.info('Processing tech fee expenses for December 30, 2025...');
  //     const expenseService = new ExpenseService();
  //     await expenseService.processTechFeeExpenses();
  //     logger.info('Tech fee expenses processed successfully for December 30, 2025.');
  //   } catch (error) {
  //     logger.error("Error processing tech fee expenses:", error);
  //   }
  // });

  // // January 15, 2026 at 8 AM EST (one-time)
  // schedule.scheduleJob({ year: 2026, month: 0, date: 15, hour: 8, minute: 0, tz: "America/New_York" }, async () => {
  //   try {
  //     logger.info('Processing tech fee expenses for January 15, 2026...');
  //     const expenseService = new ExpenseService();
  //     await expenseService.processTechFeeExpenses();
  //     logger.info('Tech fee expenses processed successfully for January 15, 2026.');
  //   } catch (error) {
  //     logger.error("Error processing tech fee expenses:", error);
  //   }
  // });

  // // February 1, 2026 at 8 AM EST (one-time)
  // schedule.scheduleJob({ year: 2026, month: 1, date: 1, hour: 8, minute: 0, tz: "America/New_York" }, async () => {
  //   try {
  //     logger.info('Processing tech fee expenses for February 1, 2026...');
  //     const expenseService = new ExpenseService();
  //     await expenseService.processTechFeeExpenses();
  //     logger.info('Tech fee expenses processed successfully for February 1, 2026.');
  //   } catch (error) {
  //     logger.error("Error processing tech fee expenses:", error);
  //   }
  // });

  // 1st of every month at 8 AM EST (recurring, starting March 1, 2026)
  schedule.scheduleJob({ date: 1, hour: 8, minute: 0, tz: "America/New_York" }, async () => {
    try {
      // Only run from March 2026 onwards
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-indexed

      // Skip if before March 2026 (month 2 = March)
      if (currentYear < 2026 || (currentYear === 2026 && currentMonth < 2)) {
        logger.info(`Skipping tech fee processing - before March 2026 (current: ${currentYear}-${currentMonth + 1})`);
        return;
      }

      logger.info('Processing monthly tech fee expenses...');
      const expenseService = new ExpenseService();
      await expenseService.processTechFeeExpenses();
      logger.info('Monthly tech fee expenses processed successfully.');
    } catch (error) {
      logger.error("Error processing monthly tech fee expenses:", error);
    }
  });

  // Database Backup - Daily at 2 AM EST
  schedule.scheduleJob(
    { hour: 2, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info('Database backup scheduled task started...');
        const backupService = new DatabaseBackupService();
        await backupService.processScheduledBackup();
        logger.info('Database backup scheduled task completed successfully.');
      } catch (error) {
        logger.error("Error in database backup scheduled task:", error);
      }
    }
  );

  // Automated Access Code Generation - Daily at 4 AM EST
  schedule.scheduleJob(
    { hour: 6, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info('Automated access code generation scheduled task started...');
        const accessCodeScheduler = new AccessCodeSchedulerService();
        const result = await accessCodeScheduler.processAutomatedAccessCodes();
        logger.info(`Automated access code generation completed: ${result.processed} processed, ${result.skipped} skipped, ${result.failed} failed`);
      } catch (error) {
        logger.error("Error in automated access code generation:", error);
      }
    }
  );

  // Process Scheduled Access Codes - Daily at 5 AM EST
  // This job finds all access codes with check-in date = today and sets them on devices
  // with proper validity (startsAt, endsAt) based on listing times and property settings
  schedule.scheduleJob(
    { hour: 7, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info("Daily access code processing job started (5 AM EST)...");
        const accessCodeService = new SmartLockAccessCodeService();
        const result = await accessCodeService.processScheduledCodes();
        logger.info(`Daily access code processing completed: ${result.processed} set on devices, ${result.failed} failed`);
      } catch (error) {
        logger.error("Error processing scheduled access codes:", error);
      }
    }
  );

  // Missed Clock-Out Detection - Every 3 hours
  // Detects time entries that have been 'active' for more than 12 hours
  // Auto-completes them and caps computed duration at user's daily limit
  schedule.scheduleJob(
    "0 * * * *",  // Every hour at minute 0
    async () => {
      try {
        logger.info("Missed clock-out detection job started...");
        const timeEntryService = new TimeEntryService();
        const result = await timeEntryService.processMissedClockouts();
        logger.info(`Missed clock-out detection completed: ${result.processed} entries processed`);
      } catch (error) {
        logger.error("Error processing missed clock-outs:", error);
      }
    }
  );

  // Cleaner Checkout SMS Notifications - every 20 minutes, using each listing's local schedule settings
  schedule.scheduleJob(
    "*/20 * * * *",
    async () => {
      try {
        logger.info('[CleanerCheckoutSMS] Scheduled task started - processing checkout notification schedules...');

        const cleanerNotificationService = new CleanerNotificationService();
        const result = await cleanerNotificationService.processAutomatedCheckoutSMS();

        logger.info(`[CleanerCheckoutSMS] Scheduled task completed - Sent: ${result.sent}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
      } catch (error) {
        logger.error("[CleanerCheckoutSMS] Error in scheduled task:", error);
      }
    }
  );

  // DISABLED: No-Booking Alert (replaced by Latest Booking Report below)
  // schedule.scheduleJob(
  //   { hour: 6, minute: 0, dayOfWeek: 1, tz: "America/New_York" },
  //   async () => {
  //     try {
  //       logger.info('[NoBookingAlert] Checking for listings without bookings for 7 days...');
  //       const noBookingAlertService = new NoBookingAlertService();
  //       await noBookingAlertService.checkAndTriggerAlerts();
  //       logger.info('[NoBookingAlert] Check completed.');
  //     } catch (error) {
  //       logger.error("[NoBookingAlert] Error checking for listings without bookings:", error);
  //     }
  //   }
  // );

  // Latest Booking Report - Every Monday at 6 AM EST
  // Sends email with the most recent reservation per every active listing
  schedule.scheduleJob(
    { hour: 6, minute: 0, dayOfWeek: 1, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[LatestBookingReport] Sending latest booking report...');
        const latestBookingReportService = new LatestBookingReportService();
        await latestBookingReportService.sendReport();
        logger.info('[LatestBookingReport] Report sent.');
      } catch (error) {
        logger.error("[LatestBookingReport] Error sending latest booking report:", error);
      }
    }
  );

  // Scheduled AI Guest Analysis - runs daily in SecureStay and posts each generated version to tracked Slack threads.
  schedule.scheduleJob(
    { hour: 10, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[GuestAnalysis] Scheduled AI analysis job started...');
        const guestAnalysisService = new GuestAnalysisService();
        const result = await guestAnalysisService.processScheduledAnalysis();
        logger.info(`[GuestAnalysis] Scheduled job completed - Processed: ${result.processed}, Failed: ${result.failed}, Skipped: ${result.skipped}`);
      } catch (error) {
        logger.error("[GuestAnalysis] Error in scheduled AI analysis job:", error);
      }
    }
  );

  // Inbox AI nightly self-improvement audit — 3:30 AM EST.
  // Captures the human reply the team actually sent for each recent AI suggestion
  // (comparison data) and extracts frequently-asked facts per property + portfolio
  // as PENDING learned facts for staff review. Never sends messages; extraction is
  // killable via AI_NIGHTLY_AUDIT_ENABLED=false.
  schedule.scheduleJob(
    { hour: 3, minute: 30, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[InboxAIAudit] Nightly audit scheduled task started...');
        const auditService = new InboxAIAuditService();
        await auditService.runNightlyAudit();
        logger.info('[InboxAIAudit] Nightly audit scheduled task completed.');
      } catch (error) {
        logger.error("[InboxAIAudit] Error in nightly audit scheduled task:", error);
      }
    }
  );

  // Admin workload: sync recent Quo calls + AI-grade each employee's day
  // (active minutes + quality) for the admin insights page.
  schedule.scheduleJob(
    { hour: 4, minute: 45, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[AdminWorkload] Nightly call sync + day grading started...');
        const { AdminWorkloadService } = await import("../services/AdminWorkloadService");
        await new AdminWorkloadService().refresh({ sinceDays: 3, gradeDays: 30, maxCells: 150 });
        logger.info('[AdminWorkload] Nightly call sync + day grading completed.');
      } catch (error) {
        logger.error("[AdminWorkload] Error in nightly workload task:", error);
      }
    }
  );

  // Automated guest messages (rule-based: inquiry winback, pre-arrival /
  // checkout reminders, trash-day notes, one-off follow-ups). Every 10 minutes,
  // offset by 3 min to avoid colliding with the other */5 jobs. Idempotent —
  // each (rule, thread, occurrence) is claimed in auto_message_log before
  // delivery. Kill switch: AUTO_MESSAGES_ENABLED=false.
  schedule.scheduleJob(
    "3-59/10 * * * *",
    async () => {
      try {
        const autoMessageService = new AutoMessageService();
        const result = await autoMessageService.processDueMessages();
        if (result.evaluated > 0 && (result.sent || result.failed)) {
          logger.info(`[AutoMessage] Sweep — sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}`);
        }
      } catch (error) {
        logger.error("[AutoMessage] Error in scheduled sweep:", error);
      }
    }
  );

  // Overdue payment sweep — refresh Hostify paid_part/paid_sum for non-Airbnb
  // reservations in the current+upcoming+recent window so the Overdue Payments
  // page reads our DB, and clear payment emergencies once settled. Every 3 hours.
  schedule.scheduleJob(
    "7 */3 * * *",
    async () => {
      try {
        logger.info('[OverduePayment] Payment status sweep started...');
        const overduePaymentService = new OverduePaymentService();
        const result = await overduePaymentService.syncPaymentStatus();
        logger.info(`[OverduePayment] Payment status sweep completed — checked=${result.checked}, updated=${result.updated}, emergenciesCleared=${result.emergenciesCleared}`);
      } catch (error) {
        logger.error("[OverduePayment] Error in payment status sweep:", error);
      }
    }
  );

  // Register the Quo message webhook on boot (idempotent) so new messages
  // arrive in real time; the 3-minute poll below stays as reconciliation.
  if (QuoInboxService.isConfigured()) {
    setTimeout(async () => {
      try {
        const result = await new QuoInboxService().ensureWebhook();
        if (result.skipped) {
          logger.warn(`[QuoInbox] Webhook registration skipped: ${result.skipped}`);
        } else if (result.created) {
          logger.info('[QuoInbox] Webhook registered with Quo.');
        }
      } catch (error) {
        logger.error('[QuoInbox] Webhook registration failed:', error);
      }
    }, 15 * 1000);

    // One-time PM client backfill shortly after boot: link existing PM-line
    // conversations to clients so the AI context works from day one instead of
    // waiting for the nightly pipeline.
    setTimeout(async () => {
      try {
        const relink = await new QuoInboxService().relinkPmClients();
        if (relink.linked) {
          logger.info(`[PMClientSync] Boot relink — linked=${relink.linked}/${relink.scanned}`);
        }
      } catch (error) {
        logger.error('[PMClientSync] Boot relink failed:', error);
      }
    }, 60 * 1000);
  }

  // Quo (OpenPhone) SMS inbox sync — every 3 minutes, PM/GR lines only.
  // Polls conversations + messages into quo_conversations / quo_messages and
  // runs action-item detection on threads with new incoming messages.
  // Kill switch: QUO_INBOX_SYNC_ENABLED=false.
  schedule.scheduleJob(
    "1-59/3 * * * *",
    async () => {
      if (String(process.env.QUO_INBOX_SYNC_ENABLED || "true").toLowerCase() === "false") return;
      if (!QuoInboxService.isConfigured()) return;
      try {
        const quoService = new QuoInboxService();
        const result = await quoService.syncAll();
        if (result.conversations || result.messages) {
          logger.info(`[QuoInbox] Sync — lines=${result.lines}, conversations=${result.conversations}, messages=${result.messages}`);
        }
        if (result.newIncoming.length) {
          const detector = new QuoItemDetectionService();
          const detection = await detector.detectForConversations(result.newIncoming);
          if (detection.created) {
            logger.info(`[QuoInbox] Detection created ${detection.created} action item(s)`);
          }
          // Shadow AI suggestions for linked threads (audit/analytics dataset).
          const { InboxAIService } = require("../services/InboxAIService");
          for (const cid of result.newIncoming) InboxAIService.scheduleQuoSuggestion(cid);
        }
      } catch (error) {
        logger.error("[QuoInbox] Error in scheduled sync:", error);
      }
    }
  );

  // Quo shadow-suggestion catch-up — every 15 minutes. The per-message debounce
  // timers are in-process (lost on deploy/restart) and threads answered inside
  // the debounce window used to be skipped entirely; this sweep generates any
  // missing shadow suggestion for recently-active linked threads so the
  // audit/analytics dataset stays complete. Deduped per message = cheap reruns.
  schedule.scheduleJob(
    "7-59/15 * * * *",
    async () => {
      if (String(process.env.QUO_INBOX_SYNC_ENABLED || "true").toLowerCase() === "false") return;
      if (!QuoInboxService.isConfigured()) return;
      try {
        const { InboxAIService } = require("../services/InboxAIService");
        await new InboxAIService().quoCatchUpSweep();
      } catch (error) {
        logger.error("[QuoInbox] Error in shadow-suggestion catch-up sweep:", error);
      }
    }
  );

  // PM client data pipeline — daily at 4:40 AM ET:
  //  1. Sync Hostify owners into client_management/client_properties (the
  //     "client data" table the PM-inbox AI reads its context from).
  //  2. Re-link PM-line Quo conversations to clients (new phone numbers land).
  // Kill switch: PM_CLIENT_SYNC_ENABLED=false.
  schedule.scheduleJob(
    { hour: 4, minute: 40, tz: "America/New_York" },
    async () => {
      if (String(process.env.PM_CLIENT_SYNC_ENABLED || "true").toLowerCase() === "false") return;
      try {
        const { HostifyOwnerSyncService } = require("../services/HostifyOwnerSyncService");
        const result = await new HostifyOwnerSyncService().syncOwners("system-cron");
        logger.info(`[PMClientSync] Owner sync — created=${result.created}, updated=${result.updated}, skipped=${result.skipped}`);
      } catch (error) {
        logger.error("[PMClientSync] Owner sync failed:", error);
      }
      try {
        if (QuoInboxService.isConfigured()) {
          const relink = await new QuoInboxService().relinkPmClients();
          logger.info(`[PMClientSync] PM conversation relink — linked=${relink.linked}/${relink.scanned}`);
        }
      } catch (error) {
        logger.error("[PMClientSync] PM conversation relink failed:", error);
      }
    }
  );

  // GR Tasks Overdue Escalation - Every 5 minutes (offset by 2 min to avoid colliding with checkUnasweredMessagesHostify)
  schedule.scheduleJob(
    "2-59/5 * * * *",
    async () => {
      try {
        logger.info('[GRTasksEscalation] Processing overdue tasks...');
        const escalationService = new EscalationService();
        await escalationService.processOverdueTasks();
        logger.info('[GRTasksEscalation] Overdue task processing completed.');
      } catch (error) {
        logger.error("[GRTasksEscalation] Error processing overdue tasks:", error);
      }
    }
  );

  // Resolutions Team — daily check-in messages to #resolutions-team at 9:05 AM EST
  // The Slack service also ensures today's review-checkout records before posting.
  schedule.scheduleJob(
    { hour: 9, minute: 5, tz: "America/New_York" },
    async () => {
      try {
        logger.info("[ResolutionsTeam] Posting daily check-in messages to #resolutions-team...");
        const resolutionsService = new ResolutionsTeamSlackService();
        await resolutionsService.postDailyCheckoutMessages();
        logger.info("[ResolutionsTeam] Daily check-in messages posted.");
      } catch (error) {
        logger.error("[ResolutionsTeam] Error posting daily check-in messages:", error);
      }
    }
  );

  // GR Tasks Daily Reminder - 10 AM EST for In Progress tasks
  schedule.scheduleJob(
    { hour: 9, minute: 15, tz: "America/New_York" },
    async () => {
      try {
        logger.info("[ResolutionsTeam] Processing days-left review reminders...");
        const resolutionsService = new ResolutionsTeamSlackService();
        await resolutionsService.sendDaysLeftReviewReminders();
        logger.info("[ResolutionsTeam] Days-left review reminders completed.");
      } catch (error) {
        logger.error("[ResolutionsTeam] Error processing days-left review reminders:", error);
      }
    }
  );

  // GR Tasks Daily Reminder - 10 AM EST for In Progress tasks
  schedule.scheduleJob(
    { hour: 10, minute: 0, tz: "America/New_York" },
    async () => {
      try {
        logger.info('[GRTasksEscalation] Processing daily reminders for In Progress tasks...');
        const escalationService = new EscalationService();
        await escalationService.processDailyReminders();
        logger.info('[GRTasksEscalation] Daily reminder processing completed.');
      } catch (error) {
        logger.error("[GRTasksEscalation] Error processing daily reminders:", error);
      }
    }
  );

  // Check-In Notification SMS - every 20 minutes, using each listing's local schedule settings
  schedule.scheduleJob(
    "*/20 * * * *",
    async () => {
      try {
        logger.info('[CheckInSMS] Scheduled task started - processing check-in notification schedules...');
        const checkInNotificationService = new CheckInNotificationService();
        await checkInNotificationService.processAutomatedCheckInSMS();
        logger.info('[CheckInSMS] Scheduled task completed.');
      } catch (error) {
        logger.error("[CheckInSMS] Error in scheduled task:", error);
      }
    }
  );

  // Hostify owner-contract -> client/property sync, hourly at minute 0.
  // Previously ran inline on every GET /clients call (~40s per request);
  // moved here so list reads stay fast.
  schedule.scheduleJob("0 * * * *", async () => {
    try {
      logger.info('[ClientOwnerSync] Hourly sync started...');
      const clientService = new ClientService();
      const result = await clientService.syncListingClientsFromOwnerContracts('system');
      logger.info('[ClientOwnerSync] Hourly sync completed.', result);
    } catch (error) {
      logger.error('[ClientOwnerSync] Error in hourly sync:', error);
    }
  });

  // Turnover recipient sync from Vendors and All Listings, daily at 8 AM EST.
  schedule.scheduleJob({ hour: 8, minute: 0, tz: "America/New_York" }, async () => {
    try {
      logger.info('[TurnoverRecipientSync] Daily sync started...');
      const turnoverService = new TurnoverService();
      const result = await turnoverService.syncRecipients('system');
      logger.info('[TurnoverRecipientSync] Daily sync completed.', result);
    } catch (error) {
      logger.error('[TurnoverRecipientSync] Error in daily sync:', error);
    }
  });

  // Daily OpenAI API Health Check - 9:15 AM EST
  // Pings OpenAI with a minimal request. If the call fails (e.g. 429 quota
  // exceeded, auth error, network error), DMs Slack user U08END0JTBM with the
  // error details so the team can react before downstream jobs (review
  // sentiment, listing generation, etc.) start failing.
  const OPENAI_HEALTHCHECK_SLACK_USER_ID = "U08END0JTBM";
  schedule.scheduleJob(
    { hour: 12, minute: 15, tz: "America/New_York" },
    async () => {
      logger.info('[OpenAIHealthCheck] Running daily OpenAI API health check...');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        logger.error('[OpenAIHealthCheck] OPENAI_API_KEY is not set.');
        await sendSlackMessage({
          channel: OPENAI_HEALTHCHECK_SLACK_USER_ID,
          text: ":rotating_light: *OpenAI API Health Check Failed*\nReason: `OPENAI_API_KEY` is not set on secure-stay-server.",
        });
        return;
      }

      try {
        const openai = new OpenAI({ apiKey });
        await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        });
        logger.info('[OpenAIHealthCheck] OpenAI API is healthy.');
      } catch (error: any) {
        const status = error?.status ?? error?.response?.status;
        const errCode = error?.code ?? error?.error?.code ?? "unknown";
        const errMessage =
          error?.error?.message ||
          error?.message ||
          "Unknown error from OpenAI API";

        logger.error(
          `[OpenAIHealthCheck] OpenAI API check failed — status=${status} code=${errCode} message=${errMessage}`
        );

        const slackText = [
          ":rotating_light: *OpenAI API Health Check Failed*",
          `*Status:* ${status ?? "n/a"}`,
          `*Code:* ${errCode}`,
          `*Message:* ${errMessage}`,
          status === 429
            ? "This looks like a quota / rate-limit error. Please check the OpenAI plan & billing details: https://platform.openai.com/account/billing"
            : "Please investigate before downstream AI jobs are affected.",
        ].join("\n");

        await sendSlackMessage({
          channel: OPENAI_HEALTHCHECK_SLACK_USER_ID,
          text: slackText,
        });
      }
    }
  );
}
