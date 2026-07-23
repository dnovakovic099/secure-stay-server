-- Migration: Communication-rule proposals (approval queue)
-- Date: 2026-07-24
--
-- Lets managers propose updates to Settings "Communication rules" from feedback
-- without writing live rules until someone approves. Mirrors the learned-facts
-- pending → approve / reject pattern.

CREATE TABLE IF NOT EXISTS `ai_communication_rule_proposals` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `topic` VARCHAR(160) NOT NULL,
    `rule` MEDIUMTEXT NOT NULL,
    `appliesTo` VARCHAR(255) NULL,
    -- pending | approved | rejected
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `rationale` TEXT NULL,
    -- JSON number[] of ai_message_feedback.id that motivated this proposal
    `sourceFeedbackIds` TEXT NULL,
    -- Snapshot of the feedback / preferred wording for reviewers
    `sourceSummary` MEDIUMTEXT NULL,
    `proposedByUserId` INT NULL,
    `proposedByName` VARCHAR(255) NULL,
    `reviewedByUserId` INT NULL,
    `reviewedByName` VARCHAR(255) NULL,
    `reviewedAt` DATETIME NULL,
    `reviewNote` TEXT NULL,
    -- id of the communicationRuleEntries item created on approve
    `createdEntryId` VARCHAR(64) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_acrp_status` (`status`),
    INDEX `idx_acrp_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
