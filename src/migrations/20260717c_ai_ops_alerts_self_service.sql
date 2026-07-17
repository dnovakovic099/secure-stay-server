-- Ops Radar: one table for every manager-facing alert the AI raises
-- (predictive maintenance, recurring root causes, SLA breaches, review
-- risks, turnover risks). Alerts self-resolve when the condition clears;
-- dismissed alerts stay dismissed (dedupeKey keeps them from reappearing).
CREATE TABLE IF NOT EXISTS `ai_ops_alerts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `type` VARCHAR(24) NOT NULL,
    `severity` VARCHAR(12) NOT NULL DEFAULT 'medium',
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `dedupeKey` VARCHAR(160) NOT NULL,
    `listingId` BIGINT NULL,
    `listingName` VARCHAR(255) NULL,
    `threadId` BIGINT NULL,
    `reservationId` BIGINT NULL,
    `title` VARCHAR(300) NOT NULL,
    `detail` TEXT NULL,
    `recommendation` TEXT NULL,
    `payload` MEDIUMTEXT NULL,
    `actionItemId` INT NULL,
    `dismissedByUserId` INT NULL,
    `resolvedAt` DATETIME NULL,
    `lastSeenAt` DATETIME NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `UQ_ai_ops_alerts_dedupe` (`dedupeKey`),
    INDEX `IDX_ai_ops_alerts_type_status` (`type`, `status`),
    INDEX `IDX_ai_ops_alerts_status_sev` (`status`, `severity`)
);

-- Guest self-service troubleshooting: when ON, the assistant walks guests
-- through documented fixes (router restart, breaker location, lock steps)
-- before the team dispatches anyone. Toggle lives in AI settings.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `selfServiceTroubleshootingEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `inquiryAutoRespondEnabled`;
