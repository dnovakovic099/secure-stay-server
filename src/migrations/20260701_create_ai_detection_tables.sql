-- Migration: AI detection of our own Action Items + Guest Issues
-- Date: 2026-07-01
--
-- Builds the (currently DORMANT) pipeline that lets the assistant detect and
-- propose Action Items and Guest Issues directly from guest messages, instead
-- of relying on HostBuddy. It is gated OFF by default (env AI_ITEM_DETECTION_ENABLED
-- plus the ai_messaging_settings.itemDetectionEnabled toggle) and only ever writes
-- PROPOSALS to ai_detected_items — it never touches the live action-item / issue
-- tables until we explicitly switch it on.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS `ai_detected_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    -- 'action_item' | 'guest_issue'
    `type` VARCHAR(20) NOT NULL,
    `threadId` BIGINT NULL,
    `messageId` BIGINT NULL,
    `reservationId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `title` VARCHAR(255) NULL,
    `description` MEDIUMTEXT NULL,
    `category` VARCHAR(120) NULL,
    -- action item: low|medium|high|urgent ; guest issue: low|medium|high|critical
    `priority` VARCHAR(20) NULL,
    `confidence` DECIMAL(5,2) NULL,
    -- proposed | approved | rejected | created (created = pushed to a real item)
    `status` VARCHAR(20) NOT NULL DEFAULT 'proposed',
    -- raw model payload for audit / future field mapping.
    `payload` MEDIUMTEXT NULL,
    `modelName` VARCHAR(64) NULL,
    `promptVersion` VARCHAR(32) NULL,
    `reviewedByUserId` INT NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_adi_type` (`type`),
    INDEX `idx_adi_thread` (`threadId`),
    INDEX `idx_adi_status` (`status`),
    INDEX `idx_adi_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Detection controls live alongside the assistant's other settings.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `itemDetectionEnabled` TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `actionItemRules` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `guestIssueRules` TEXT NULL,
    ADD COLUMN IF NOT EXISTS `detectionFeedback` TEXT NULL;
