import { DataSource } from "typeorm";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import logger from "./logger.utils";

interface MigrationRecord {
    filename: string;
    executed_at: Date;
    execution_time_ms: number;
    checksum: string;
}

/**
 * Creates the migrations_history table if it doesn't exist
 */
async function ensureMigrationsTable(dataSource: DataSource): Promise<void> {
    const query = `
    CREATE TABLE IF NOT EXISTS migrations_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      execution_time_ms INT,
      checksum VARCHAR(64)
    )
  `;
    await dataSource.query(query);
    logger.info("✅ Migrations history table is ready");
}

/**
 * Fetches list of already executed migrations from the database
 */
async function getExecutedMigrations(dataSource: DataSource): Promise<Set<string>> {
    const records: MigrationRecord[] = await dataSource.query(
        "SELECT filename FROM migrations_history"
    );
    return new Set(records.map((r) => r.filename));
}

/**
 * Reads all .sql files from the migrations directory
 */
function getMigrationFiles(migrationsDir: string): string[] {
    if (!fs.existsSync(migrationsDir)) {
        // Gracefully handle missing folder - just return empty array
        return [];
    }

    return fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql"))
        .sort(); // Alphabetical order (date-prefixed files sort chronologically)
}

/**
 * Generates MD5 checksum of file content
 */
function generateChecksum(filePath: string): string {
    const content = fs.readFileSync(filePath, "utf-8");
    return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Executes a single migration file
 */
async function executeMigration(
    dataSource: DataSource,
    migrationsDir: string,
    filename: string
): Promise<void> {
    const filePath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const checksum = generateChecksum(filePath);

    const startTime = Date.now();

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Split by semicolon and execute each statement
        const statements = content
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.startsWith("--"));

        for (const statement of statements) {
            await queryRunner.query(statement);
        }

        const executionTime = Date.now() - startTime;

        // Record the migration in history
        await queryRunner.query(
            `INSERT INTO migrations_history (filename, execution_time_ms, checksum) VALUES (?, ?, ?)`,
            [filename, executionTime, checksum]
        );

        await queryRunner.commitTransaction();
        logger.info(`✅ Executed migration: ${filename} (${executionTime}ms)`);
    } catch (error) {
        await queryRunner.rollbackTransaction();
        logger.error(`❌ Failed to execute migration: ${filename}`, error);
        throw error;
    } finally {
        await queryRunner.release();
    }
}

/**
 * Main function to run all pending migrations
 */
export async function runMigrations(dataSource: DataSource): Promise<{ executed: string[]; skipped: string[]; }> {
    // Use src/migrations - this will be dist/out-tsc/migrations in production
    const migrationsDir = path.resolve(__dirname, "../migrations");

    logger.info("🔍 Checking for pending migrations...");

    // Ensure migrations table exists
    await ensureMigrationsTable(dataSource);

    // Get executed migrations
    const executedMigrations = await getExecutedMigrations(dataSource);

    // Get all migration files
    const allMigrations = getMigrationFiles(migrationsDir);

    if (allMigrations.length === 0) {
        logger.info("📂 No migration files found (src/migrations folder may not exist yet)");
        return { executed: [], skipped: [] };
    }

    // Filter out already executed migrations
    const pendingMigrations = allMigrations.filter(
        (file) => !executedMigrations.has(file)
    );
    const skippedMigrations = allMigrations.filter((file) =>
        executedMigrations.has(file)
    );

    if (pendingMigrations.length === 0) {
        logger.info("✨ All migrations are up to date");
        return { executed: [], skipped: skippedMigrations };
    }

    logger.info(
        `📋 Found ${pendingMigrations.length} pending migration(s), ${skippedMigrations.length} already executed`
    );

    // Execute pending migrations
    const executed: string[] = [];
    for (const migration of pendingMigrations) {
        await executeMigration(dataSource, migrationsDir, migration);
        executed.push(migration);
    }

    logger.info(`✨ Successfully executed ${executed.length} migration(s)`);

    return { executed, skipped: skippedMigrations };
}

export default runMigrations;
