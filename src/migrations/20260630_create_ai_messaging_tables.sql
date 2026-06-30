-- Migration: AI messaging — suggestion + feedback tables for the v2 Inbox AI assistant
-- Date: 2026-06-30
--
-- These power the "AI suggested reply" feature in the v2 inbox. The assistant is
-- SUGGESTION-ONLY (it never auto-sends). Every suggestion is persisted so we can
-- compare it against the human reply and learn from feedback over time.
--
-- Kept additive and isolated from the inbox_conversations / inbox_messages tables.
-- Gated at runtime behind AI_MESSAGING_ENABLED.

CREATE TABLE IF NOT EXISTS `ai_message_suggestions` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `threadId` BIGINT NOT NULL,
    -- externalId of the inbound guest message this suggestion responds to (nullable
    -- when generated for a whole thread with no single triggering message).
    `messageId` BIGINT NULL,
    `reservationId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `suggestedReply` MEDIUMTEXT NULL,
    -- 0..100 model-reported confidence.
    `confidence` DECIMAL(5,2) NULL,
    `escalationRequired` TINYINT NOT NULL DEFAULT 0,
    `escalationReason` VARCHAR(500) NULL,
    `internalSummary` TEXT NULL,
    -- JSON-encoded arrays.
    `sourcesUsed` TEXT NULL,
    `warnings` TEXT NULL,
    `suggestedActionItems` TEXT NULL,
    `modelName` VARCHAR(64) NULL,
    `promptVersion` VARCHAR(32) NULL,
    -- suggested | accepted | edited | ignored | rejected | regenerated
    `status` VARCHAR(20) NOT NULL DEFAULT 'suggested',
    `acceptedByUserId` INT NULL,
    `finalSentMessageId` BIGINT NULL,
    -- raw model response for debugging/audit.
    `rawResponse` MEDIUMTEXT NULL,
    `generatedAt` DATETIME NOT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_ai_suggestions_thread` (`threadId`),
    INDEX `idx_ai_suggestions_message` (`messageId`),
    INDEX `idx_ai_suggestions_status` (`status`),
    INDEX `idx_ai_suggestions_generated_at` (`generatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ai_message_feedback` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `suggestionId` INT NULL,
    `threadId` BIGINT NULL,
    `messageId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `reservationId` BIGINT NULL,
    `userId` INT NULL,
    -- 'up' | 'down' | null
    `rating` VARCHAR(10) NULL,
    -- JSON-encoded array of category tags.
    `categories` TEXT NULL,
    `feedbackText` TEXT NULL,
    `correctedResponse` MEDIUMTEXT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_ai_feedback_suggestion` (`suggestionId`),
    INDEX `idx_ai_feedback_thread` (`threadId`),
    INDEX `idx_ai_feedback_user` (`userId`),
    INDEX `idx_ai_feedback_created_at` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
