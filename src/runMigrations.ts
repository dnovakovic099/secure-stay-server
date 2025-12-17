import "dotenv/config";
import { appDatabase, initDatabase } from "./utils/database.util";
import { runMigrations } from "./utils/migrationRunner.util";
import logger from "./utils/logger.utils";

/**
 * Standalone script to run database migrations
 * Usage: npm run migrate
 */
async function main() {
    console.log("🚀 Starting migration runner...");

    try {
        // Initialize database connection
        console.log("📌 Connecting to database...");
        await initDatabase();
        console.log("✅ Database connected");

        // Run migrations
        console.log("🔍 Running migrations...");
        const result = await runMigrations(appDatabase);

        console.log(`📊 Migration Summary:`);
        console.log(`   - Executed: ${result.executed.length}`);
        console.log(`   - Skipped (already run): ${result.skipped.length}`);

        if (result.executed.length > 0) {
            console.log(`   - Files executed: ${result.executed.join(", ")}`);
        }

        console.log("✨ Migration completed successfully");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        logger.error("❌ Migration failed:", error);
        process.exit(1);
    }
}

main();
