-- AI proposed actions: one-click staff-approved operations the assistant
-- detects from guest messages (late checkout, lock code resend, ops tickets).
CREATE TABLE IF NOT EXISTS `ai_proposed_actions` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `suggestionId` INT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'hostify',
    `threadId` BIGINT NOT NULL,
    `messageId` BIGINT NULL,
    `reservationId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `actionType` VARCHAR(32) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `evidence` TEXT NULL,
    `proposedReply` MEDIUMTEXT NULL,
    `taskDescription` TEXT NULL,
    `payload` MEDIUMTEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'proposed',
    `resultNote` VARCHAR(500) NULL,
    `executedByUserId` INT NULL,
    `executedByName` VARCHAR(255) NULL,
    `executedAt` DATETIME NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `IDX_ai_proposed_actions_thread` (`threadId`, `status`),
    INDEX `IDX_ai_proposed_actions_status` (`status`, `createdAt`)
);

-- Tiered auto-send: delayed sends are queued on the suggestion row so a human
-- can veto them from the inbox before delivery.
ALTER TABLE `ai_message_suggestions`
    ADD COLUMN IF NOT EXISTS `autosendScheduledAt` DATETIME NULL AFTER `verifierNote`;

-- Sales-mode flag: set when the suggestion was drafted with the inquiry sales
-- prompt, so inquiry conversion can be measured honestly.
ALTER TABLE `ai_message_suggestions`
    ADD COLUMN IF NOT EXISTS `salesMode` TINYINT NOT NULL DEFAULT 0 AFTER `autosendScheduledAt`;

-- Confidence-tiered automation settings + inquiry sales mode settings.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `autosendTierEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `autosendChannels`,
    ADD COLUMN IF NOT EXISTS `autosendInstantMinConfidence` INT NOT NULL DEFAULT 95 AFTER `autosendTierEnabled`,
    ADD COLUMN IF NOT EXISTS `autosendDelayedMinConfidence` INT NOT NULL DEFAULT 85 AFTER `autosendInstantMinConfidence`,
    ADD COLUMN IF NOT EXISTS `autosendDelayMinutes` INT NOT NULL DEFAULT 5 AFTER `autosendDelayedMinConfidence`,
    ADD COLUMN IF NOT EXISTS `inquirySalesRules` TEXT NULL AFTER `autosendDelayMinutes`,
    ADD COLUMN IF NOT EXISTS `inquiryAutoRespondEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `inquirySalesRules`;
