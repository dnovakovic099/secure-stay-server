import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";
import { ensureIssueMetadataColumns, ensureReviewCheckoutMetadataColumns, ensureTurnoverSettingsColumns, initDatabase } from "../utils/database.util";
import { scheduleGetReservation } from "../utils/scheduler.util";
import logger from "../utils/logger.utils";

process.on("uncaughtException", (err) => {
    logger.error("Scheduler uncaught exception:", err);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    logger.error("Scheduler unhandled rejection:", reason);
});

const main = async () => {
    await initDatabase();
    await ensureIssueMetadataColumns();
    await ensureReviewCheckoutMetadataColumns();
    await ensureTurnoverSettingsColumns();
    scheduleGetReservation();
    logger.info("Scheduler worker started");
};

main().catch((err) => {
    logger.error("Scheduler worker startup error:", err);
    process.exit(1);
});
