/**
 * Process Scheduled Access Codes Script
 * Runs periodically to set access codes that are scheduled for the current time
 * 
 * Usage: npm run process-access-codes
 * Or set up as a cron job to run every 15 minutes
 */

import "dotenv/config";
import { appDatabase, initDatabase } from "../utils/database.util";
import { SmartLockAccessCodeService } from "../services/SmartLockAccessCodeService";
import logger from "../utils/logger.utils";

async function main() {
  console.log("🔐 Starting access code processor...");

  try {
    // Initialize database connection
    console.log("📌 Connecting to database...");
    await initDatabase();
    console.log("✅ Database connected");

    // Process scheduled codes
    const accessCodeService = new SmartLockAccessCodeService();
    const result = await accessCodeService.processScheduledCodes();

    console.log(`📊 Processing Summary:`);
    console.log(`   - Processed: ${result.processed}`);
    console.log(`   - Failed: ${result.failed}`);

    console.log("✨ Access code processing completed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Access code processing failed:", error);
    logger.error("❌ Access code processing failed:", error);
    process.exit(1);
  }
}

main();
