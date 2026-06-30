-- Migration: Create inbox_conversations + inbox_messages for the v2 Inbox
-- Date: 2026-06-29
--
-- The v2 inbox reads entirely from the local DB instead of live-proxying
-- Hostify on every request. These tables are populated by:
--   1) a one-time / on-demand backfill sync from the Hostify API, and
--   2) the Hostify webhook (POST /webhook/hostify_v1), which now persists
--      EVERY message (incoming + outgoing), not just incoming guest messages.
--
-- Kept separate from the legacy `messages` table (incoming-only, feeds the
-- unanswered-message Slack alert job) to avoid changing that behaviour.

CREATE TABLE IF NOT EXISTS `inbox_conversations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `threadId` BIGINT NOT NULL,
    `reservationId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `guestId` BIGINT NULL,
    `guestName` VARCHAR(255) NULL,
    `guestPhone` VARCHAR(64) NULL,
    `guestEmail` VARCHAR(255) NULL,
    `channel` VARCHAR(64) NULL,
    `listingName` VARCHAR(255) NULL,
    `lastMessageText` TEXT NULL,
    `lastMessageAt` DATETIME NULL,
    `answered` TINYINT NOT NULL DEFAULT 0,
    `unread` TINYINT NOT NULL DEFAULT 0,
    `isArchived` TINYINT NOT NULL DEFAULT 0,
    `nights` INT NULL,
    `guests` INT NULL,
    `checkin` DATE NULL,
    `checkout` DATE NULL,
    `price` DECIMAL(12,2) NULL,
    `currency` VARCHAR(8) NULL,
    `reservationStatus` VARCHAR(64) NULL,
    `guestThumb` VARCHAR(500) NULL,
    `listingThumb` VARCHAR(500) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'hostify',
    `syncedAt` DATETIME NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_inbox_conversations_thread` (`threadId`),
    INDEX `idx_inbox_conversations_reservation` (`reservationId`),
    INDEX `idx_inbox_conversations_last_message_at` (`lastMessageAt`),
    INDEX `idx_inbox_conversations_channel` (`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `inbox_messages` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `externalId` BIGINT NOT NULL,
    `threadId` BIGINT NOT NULL,
    `reservationId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `body` MEDIUMTEXT NULL,
    `note` TEXT NULL,
    `direction` VARCHAR(10) NOT NULL,
    `senderType` VARCHAR(20) NULL,
    `senderName` VARCHAR(255) NULL,
    `isAutomatic` TINYINT NOT NULL DEFAULT 0,
    `isSms` TINYINT NOT NULL DEFAULT 0,
    `channel` VARCHAR(64) NULL,
    `attachmentUrl` VARCHAR(1000) NULL,
    `guestId` BIGINT NULL,
    `sentAt` DATETIME NOT NULL,
    `sentByUserId` INT NULL,
    `sentByName` VARCHAR(255) NULL,
    `sentVia` VARCHAR(20) NOT NULL DEFAULT 'sync',
    `source` VARCHAR(20) NOT NULL DEFAULT 'hostify',
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_inbox_messages_external` (`externalId`),
    INDEX `idx_inbox_messages_thread` (`threadId`),
    INDEX `idx_inbox_messages_reservation` (`reservationId`),
    INDEX `idx_inbox_messages_sent_at` (`sentAt`),
    INDEX `idx_inbox_messages_sent_by_user` (`sentByUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
