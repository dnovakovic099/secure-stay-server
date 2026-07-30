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
    // Do not start an API process that cannot authenticate users or serve data.
    // The process manager can restart this instance once MariaDB is reachable;
    // continuing here leaves a broken worker returning "Internal server error"
    // until a later request happens to reach a healthy worker.
    throw err;
  }

  return appDatabase;
}

async function addColumnIfMissing(table: string, column: string, definition: string) {
  const existing = await appDatabase.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (Array.isArray(existing) && existing.length > 0) return;
  try {
    await appDatabase.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    logger.info(`Added missing ${table}.${column} column`);
  } catch (error: any) {
    if (error?.code === "ER_DUP_FIELDNAME") return;
    throw error;
  }
}

export async function ensureIssueMetadataColumns() {
  if (!appDatabase.isInitialized) return;

  try {
    await addColumnIfMissing("issues", "resolution_refreshed_at", "DATETIME NULL");
    await addColumnIfMissing("issues", "resolution_refreshed_by", "VARCHAR(255) NULL");
    await addColumnIfMissing("issues", "manager_feedback_updated_at", "DATETIME NULL");
    await addColumnIfMissing("issues", "manager_feedback_updated_by", "VARCHAR(255) NULL");
  } catch (error) {
    logger.error("Failed to ensure issue metadata columns:", error);
    throw error;
  }
}

export async function ensureReviewCheckoutMetadataColumns() {
  if (!appDatabase.isInitialized) return;

  try {
    await addColumnIfMissing("review_checkout", "mitigation_urgency", "INT NULL");
  } catch (error) {
    logger.error("Failed to ensure review_checkout metadata columns:", error);
    throw error;
  }
}

export async function ensureUpsellPropertyConfigColumns() {
  if (!appDatabase.isInitialized) return;

  try {
    await addColumnIfMissing("upsell_property_config", "taxable", "TINYINT(1) NULL DEFAULT 0");
  } catch (error) {
    logger.error("Failed to ensure upsell property config columns:", error);
    throw error;
  }
}

let inboxConversationAiNeedsHumanSchemaEnsured = false;

/**
 * Inbox V2 reads every mapped inbox_conversations column, so deploying the
 * AI Needs Team entity fields before its SQL migration makes the entire list
 * endpoint fail with ER_BAD_FIELD_ERROR. Keep the startup path self-healing,
 * consistent with the other runtime schema guards in this file.
 */
export async function ensureInboxConversationAiNeedsHumanColumns() {
  if (!appDatabase.isInitialized || inboxConversationAiNeedsHumanSchemaEnsured) return;

  try {
    await addColumnIfMissing("inbox_conversations", "aiNeedsHuman", "TINYINT NOT NULL DEFAULT 0");
    await addColumnIfMissing("inbox_conversations", "aiNeedsHumanKind", "VARCHAR(32) NULL");
    await addColumnIfMissing("inbox_conversations", "aiNeedsHumanReason", "VARCHAR(500) NULL");
    await addColumnIfMissing("inbox_conversations", "aiNeedsHumanAt", "DATETIME NULL");

    const existingIndexes = await appDatabase.query(
      "SHOW INDEX FROM inbox_conversations WHERE Key_name = ?",
      ["idx_inbox_conversations_ai_needs_human"]
    );
    if (!Array.isArray(existingIndexes) || existingIndexes.length === 0) {
      try {
        await appDatabase.query(
          "CREATE INDEX idx_inbox_conversations_ai_needs_human ON inbox_conversations (aiNeedsHuman, aiNeedsHumanAt)"
        );
        logger.info("Added missing idx_inbox_conversations_ai_needs_human index");
      } catch (error: any) {
        if (error?.code !== "ER_DUP_KEYNAME") throw error;
      }
    }

    inboxConversationAiNeedsHumanSchemaEnsured = true;
  } catch (error) {
    logger.error("Failed to ensure Inbox AI Needs Team columns:", error);
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
        pre_stay_enabled_override TINYINT(1) NOT NULL DEFAULT 0,
        pre_stay_message_template TEXT NULL,
        pre_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
        pre_stay_offset_minutes INT NULL DEFAULT 0,
        post_stay_contact_id INT NULL,
        post_stay_recipient_ids LONGTEXT NULL,
        post_stay_default_recipient_type VARCHAR(20) NULL DEFAULT 'cleaner',
        post_stay_enabled TINYINT(1) NOT NULL DEFAULT 1,
        post_stay_enabled_override TINYINT(1) NOT NULL DEFAULT 0,
        post_stay_message_template TEXT NULL,
        post_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
        post_stay_offset_minutes INT NULL DEFAULT 0,
        same_day_combined_enabled TINYINT(1) NOT NULL DEFAULT 0,
        same_day_combined_enabled_override TINYINT(1) NOT NULL DEFAULT 0,
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
    await addColumnIfMissing("pre_stay_enabled_override", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("pre_stay_message_template", "TEXT NULL");
    await addColumnIfMissing("pre_stay_schedule_mode", "VARCHAR(50) NULL DEFAULT 'auto'");
    await addColumnIfMissing("pre_stay_offset_minutes", "INT NULL DEFAULT 0");
    await addColumnIfMissing("post_stay_contact_id", "INT NULL");
    await addColumnIfMissing("post_stay_recipient_ids", "LONGTEXT NULL");
    await addColumnIfMissing("post_stay_default_recipient_type", "VARCHAR(20) NULL DEFAULT 'cleaner'");
    await addColumnIfMissing("post_stay_enabled", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("post_stay_enabled_override", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("post_stay_message_template", "TEXT NULL");
    await addColumnIfMissing("post_stay_schedule_mode", "VARCHAR(50) NULL DEFAULT 'auto'");
    await addColumnIfMissing("post_stay_offset_minutes", "INT NULL DEFAULT 0");
    await addColumnIfMissing("same_day_combined_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("same_day_combined_enabled_override", "TINYINT(1) NOT NULL DEFAULT 0");
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
