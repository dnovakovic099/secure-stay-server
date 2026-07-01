-- Migration: Listing Knowledge Base + AI messaging settings
-- Date: 2026-07-01
--
-- listing_knowledge_entries: backend store for the per-listing Knowledge Base
--   (previously browser-localStorage only). Makes property facts shared and
--   readable by InboxAIService. visibility = 'external' (guest-shareable) or
--   'internal' (staff-only guidance).
--
-- ai_messaging_settings: single global row (listingId NULL) that controls the
--   assistant's communication tone / rules / topics-to-avoid and the
--   auto-respond toggle from the AI Copilot Settings page.
--
-- Additive and idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `listing_knowledge_entries` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `listingId` BIGINT NOT NULL,
    `category` VARCHAR(120) NOT NULL DEFAULT 'General',
    -- 'external' (guest-shareable) | 'internal' (staff-only)
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'external',
    `title` VARCHAR(255) NULL,
    `content` MEDIUMTEXT NULL,
    -- JSON-encoded array of photo descriptors.
    `photos` TEXT NULL,
    `createdByUserId` INT NULL,
    `createdByName` VARCHAR(255) NULL,
    `updatedByUserId` INT NULL,
    `updatedByName` VARCHAR(255) NULL,
    -- 'manual' | 'ai_suggested'
    `source` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `isArchived` TINYINT NOT NULL DEFAULT 0,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_lke_listing` (`listingId`),
    INDEX `idx_lke_visibility` (`visibility`),
    INDEX `idx_lke_archived` (`isArchived`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ai_messaging_settings` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    -- NULL = global default row. (Reserved for future per-listing overrides.)
    `listingId` BIGINT NULL,
    -- Communication persona, e.g. 'warm', 'professional', 'concise', 'playful'.
    `tone` VARCHAR(64) NULL,
    -- Free-form communication rules the assistant must follow.
    `communicationRules` TEXT NULL,
    -- Free-form list of topics the assistant must avoid / always escalate.
    `topicsToAvoid` TEXT NULL,
    -- Auto-respond (the response bot). Default OFF.
    `autoRespondEnabled` TINYINT NOT NULL DEFAULT 0,
    `autosendMinConfidence` INT NOT NULL DEFAULT 85,
    -- CSV channel allowlist for auto-send (empty = all).
    `autosendChannels` VARCHAR(255) NULL,
    `updatedByUserId` INT NULL,
    `updatedByName` VARCHAR(255) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_ai_settings_listing` (`listingId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
