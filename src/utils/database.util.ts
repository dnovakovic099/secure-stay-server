import { DataSource } from "typeorm";
import logger from "./logger.utils";

export const appDatabase = new DataSource({
  type: "mariadb",
  host: process.env.DATABASE_URL,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  synchronize: false,
  entities: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/entity/*.js" : "src/entity/*.ts"],
  subscribers: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/subscriber/*.js" : "src/subscriber/*.ts"],
  migrations: [process.env.NODE_ENV === 'production' ? "dist/out-tsc/migration/*.js" : "src/migration/*.ts"],
  extra: {
    connectionLimit: 20,           // Reduced to prevent exhausting MySQL max_connections
    connectTimeout: 10000,         // 10 second connection timeout
    // acquireTimeout: 10000,         // Not supported by MySQL2 — use queueLimit instead
    waitForConnections: true,      // Wait for available connection instead of throwing error
    queueLimit: 50                 // Cap pending requests to prevent unbounded memory growth under burst load
  },
  charset: "utf8mb4_unicode_ci",
});


export async function initDatabase() {
  if (appDatabase.isInitialized) {
    return appDatabase;
  }

  try {
    await appDatabase.initialize();
    logger.info("📌 Database connected");
  } catch (err) {
    logger.error("❌ Database initialization failed:", err);
  }

  return appDatabase;
}

export async function ensureIssueMetadataColumns() {
  if (!appDatabase.isInitialized) return;

  const addColumnIfMissing = async (column: string, definition: string) => {
    const existing = await appDatabase.query("SHOW COLUMNS FROM issues LIKE ?", [column]);
    if (Array.isArray(existing) && existing.length > 0) return;
    await appDatabase.query(`ALTER TABLE issues ADD COLUMN ${column} ${definition}`);
    logger.info(`Added missing issues.${column} column`);
  };

  try {
    await addColumnIfMissing("resolution_refreshed_at", "DATETIME NULL");
    await addColumnIfMissing("resolution_refreshed_by", "VARCHAR(255) NULL");
    await addColumnIfMissing("manager_feedback_updated_at", "DATETIME NULL");
    await addColumnIfMissing("manager_feedback_updated_by", "VARCHAR(255) NULL");
  } catch (error) {
    logger.error("Failed to ensure issue metadata columns:", error);
    throw error;
  }
}

export async function ensureReviewCheckoutMetadataColumns() {
  if (!appDatabase.isInitialized) return;

  const addColumnIfMissing = async (column: string, definition: string) => {
    const existing = await appDatabase.query("SHOW COLUMNS FROM review_checkout LIKE ?", [column]);
    if (Array.isArray(existing) && existing.length > 0) return;
    await appDatabase.query(`ALTER TABLE review_checkout ADD COLUMN ${column} ${definition}`);
    logger.info(`Added missing review_checkout.${column} column`);
  };

  try {
    await addColumnIfMissing("mitigation_urgency", "INT NULL");
  } catch (error) {
    logger.error("Failed to ensure review_checkout metadata columns:", error);
    throw error;
  }
}
