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
    connectionLimit: 10,           // 6 processes × 10 = 60 total; keeps well under MariaDB's max_connections
    connectTimeout: 10000,         // 10 second connection timeout
    waitForConnections: true,
    queueLimit: 100,               // Higher queue to absorb bursts now that each pool is smaller
    enableKeepAlive: true,         // Detect stale connections (e.g. killed by MariaDB wait_timeout)
    keepAliveInitialDelay: 10000,
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

let turnoverSettingsSchemaEnsured = false;

export async function ensureTurnoverSettingsColumns() {
  if (!appDatabase.isInitialized || turnoverSettingsSchemaEnsured) return;

  const addColumnIfMissing = async (column: string, definition: string) => {
    const existing = await appDatabase.query("SHOW COLUMNS FROM turnover_settings LIKE ?", [column]);
    if (Array.isArray(existing) && existing.length > 0) return;
    try {
      await appDatabase.query(`ALTER TABLE turnover_settings ADD COLUMN ${column} ${definition}`);
      logger.info(`Added missing turnover_settings.${column} column`);
    } catch (error: any) {
      if (error?.code === "ER_DUP_FIELDNAME") return;
      throw error;
    }
  };

  try {
    await appDatabase.query(`
      CREATE TABLE IF NOT EXISTS turnover_settings (
        listing_id INT NOT NULL PRIMARY KEY,
        pre_stay_contact_id INT NULL,
        pre_stay_recipient_ids LONGTEXT NULL,
        pre_stay_default_recipient_type VARCHAR(20) NULL DEFAULT 'cleaner',
        pre_stay_enabled TINYINT(1) NOT NULL DEFAULT 1,
        pre_stay_message_template TEXT NULL,
        pre_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
        pre_stay_offset_minutes INT NULL DEFAULT 0,
        post_stay_contact_id INT NULL,
        post_stay_recipient_ids LONGTEXT NULL,
        post_stay_default_recipient_type VARCHAR(20) NULL DEFAULT 'cleaner',
        post_stay_enabled TINYINT(1) NOT NULL DEFAULT 1,
        post_stay_message_template TEXT NULL,
        post_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
        post_stay_offset_minutes INT NULL DEFAULT 0,
        same_day_combined_enabled TINYINT(1) NOT NULL DEFAULT 0,
        same_day_combined_recipient_ids LONGTEXT NULL,
        same_day_combined_message_template TEXT NULL,
        same_day_schedule_mode VARCHAR(50) NULL DEFAULT 'post-stay',
        same_day_offset_minutes INT NULL DEFAULT 0,
        owner_name VARCHAR(255) NULL,
        owner_email VARCHAR(255) NULL,
        owner_phone VARCHAR(255) NULL,
        cleaner_sender_number VARCHAR(100) NULL,
        cleaner_sender_number_group1 VARCHAR(100) NULL,
        cleaner_sender_number_group2 VARCHAR(100) NULL,
        owner_sender_number VARCHAR(100) NULL,
        reservation_change_updates_enabled TINYINT(1) NOT NULL DEFAULT 1,
        reservation_change_message_template TEXT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        updated_by VARCHAR(255) NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await addColumnIfMissing("pre_stay_contact_id", "INT NULL");
    await addColumnIfMissing("pre_stay_recipient_ids", "LONGTEXT NULL");
    await addColumnIfMissing("pre_stay_default_recipient_type", "VARCHAR(20) NULL DEFAULT 'cleaner'");
    await addColumnIfMissing("pre_stay_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("pre_stay_message_template", "TEXT NULL");
    await addColumnIfMissing("pre_stay_schedule_mode", "VARCHAR(50) NULL DEFAULT 'auto'");
    await addColumnIfMissing("pre_stay_offset_minutes", "INT NULL DEFAULT 0");
    await addColumnIfMissing("post_stay_contact_id", "INT NULL");
    await addColumnIfMissing("post_stay_recipient_ids", "LONGTEXT NULL");
    await addColumnIfMissing("post_stay_default_recipient_type", "VARCHAR(20) NULL DEFAULT 'cleaner'");
    await addColumnIfMissing("post_stay_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("post_stay_message_template", "TEXT NULL");
    await addColumnIfMissing("post_stay_schedule_mode", "VARCHAR(50) NULL DEFAULT 'auto'");
    await addColumnIfMissing("post_stay_offset_minutes", "INT NULL DEFAULT 0");
    await addColumnIfMissing("same_day_combined_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("same_day_combined_recipient_ids", "LONGTEXT NULL");
    await addColumnIfMissing("same_day_combined_message_template", "TEXT NULL");
    await addColumnIfMissing("same_day_schedule_mode", "VARCHAR(50) NULL DEFAULT 'post-stay'");
    await addColumnIfMissing("same_day_offset_minutes", "INT NULL DEFAULT 0");
    await addColumnIfMissing("owner_name", "VARCHAR(255) NULL");
    await addColumnIfMissing("owner_email", "VARCHAR(255) NULL");
    await addColumnIfMissing("owner_phone", "VARCHAR(255) NULL");
    await addColumnIfMissing("cleaner_sender_number", "VARCHAR(100) NULL");
    await addColumnIfMissing("cleaner_sender_number_group1", "VARCHAR(100) NULL");
    await addColumnIfMissing("cleaner_sender_number_group2", "VARCHAR(100) NULL");
    await addColumnIfMissing("owner_sender_number", "VARCHAR(100) NULL");
    await addColumnIfMissing("reservation_change_updates_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("reservation_change_message_template", "TEXT NULL");
    await addColumnIfMissing("created_at", "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)");
    await addColumnIfMissing("updated_at", "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)");
    await addColumnIfMissing("updated_by", "VARCHAR(255) NULL");

    turnoverSettingsSchemaEnsured = true;
  } catch (error) {
    logger.error("Failed to ensure turnover_settings columns:", error);
    throw error;
  }
}
