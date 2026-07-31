-- Employee-facing AI assistant (the floating "Ask SecureStay" widget).
--
-- Four tables:
--   ai_assistant_conversations / _messages  chat history per employee
--   ai_assistant_audit                      every tool call, allowed or denied
--   ai_assistant_preferences                per-user widget visibility
--
-- The audit table is not optional bookkeeping: the assistant can return door
-- codes and wifi passwords, and per-person activity data is gated by role, so
-- every tool invocation records who asked, what was resolved, and whether the
-- capability check passed. Retention is handled by the ops cleanup job.

CREATE TABLE IF NOT EXISTS ai_assistant_conversations (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId BIGINT NOT NULL,
    title VARCHAR(255) NULL,
    lastMessageAt DATETIME NULL,
    isArchived TINYINT(1) NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_aac_user (userId, isArchived, lastMessageAt),
    KEY idx_aac_last (lastMessageAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_assistant_messages (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    conversationId INT NOT NULL,
    userId BIGINT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content MEDIUMTEXT NULL,
    -- Tool calls the model made to produce this answer, for "show your work".
    toolTrace MEDIUMTEXT NULL,
    modelName VARCHAR(64) NULL,
    promptTokens INT NULL,
    cachedPromptTokens INT NULL,
    completionTokens INT NULL,
    latencyMs INT NULL,
    -- Set when the answer was refused or degraded by a capability check.
    wasRestricted TINYINT(1) NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_aam_conversation (conversationId, createdAt),
    KEY idx_aam_user (userId, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_assistant_audit (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId BIGINT NULL,
    userEmail VARCHAR(255) NULL,
    conversationId INT NULL,
    question TEXT NULL,
    toolName VARCHAR(64) NOT NULL,
    toolArgs TEXT NULL,
    capability VARCHAR(64) NULL,
    -- 'allowed' | 'denied'
    decision VARCHAR(16) NOT NULL,
    denyReason VARCHAR(255) NULL,
    -- Flags tool calls that returned credentials (door codes, wifi passwords)
    -- so they can be reviewed separately from ordinary lookups.
    returnedCredentials TINYINT(1) NOT NULL DEFAULT 0,
    rowCount INT NULL,
    durationMs INT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_aaa_user (userId, createdAt),
    KEY idx_aaa_tool (toolName, createdAt),
    KEY idx_aaa_decision (decision, createdAt),
    KEY idx_aaa_creds (returnedCredentials, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_assistant_preferences (
    userId BIGINT NOT NULL PRIMARY KEY,
    isHidden TINYINT(1) NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
