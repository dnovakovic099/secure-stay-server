-- Migration: AI learning loop — reply comparison + per-property/portfolio facts
-- Date: 2026-07-02
--
-- Powers the nightly self-improvement audit for the v2 Inbox AI assistant:
--  1. We capture the human reply the team actually sent for each AI suggestion
--     (even when they didn't click "use reply") so we can compare our team's
--     answer against the AI's and learn from the divergence.
--  2. We persist frequently-asked, stable facts per property AND portfolio-wide
--     (ai_learned_facts) so the bot can be grounded in the answers the team gives
--     over and over. Auto-extracted facts start as 'pending' and only feed the
--     bot once 'approved' (reviewed in the AI Copilot tab) — nothing the audit
--     writes is ever shown to a guest without a human approving it first.
--
-- Additive and idempotent.

-- Reply-comparison columns on the existing suggestions table.
ALTER TABLE `ai_message_suggestions`
    ADD COLUMN IF NOT EXISTS `actualReplyText` MEDIUMTEXT NULL,
    ADD COLUMN IF NOT EXISTS `actualReplyMessageId` BIGINT NULL,
    ADD COLUMN IF NOT EXISTS `actualReplyAt` DATETIME NULL,
    -- 0..100 similarity between the AI suggestion and what the team actually sent.
    ADD COLUMN IF NOT EXISTS `replySimilarity` DECIMAL(5,2) NULL,
    ADD COLUMN IF NOT EXISTS `auditedAt` DATETIME NULL;

CREATE TABLE IF NOT EXISTS `ai_learned_facts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    -- 'property' (tied to a listing) | 'portfolio' (applies account-wide)
    `scope` VARCHAR(20) NOT NULL DEFAULT 'property',
    -- listingId for property-scoped facts; NULL for portfolio-wide.
    `listingId` BIGINT NULL,
    -- short topic/category slug, e.g. 'wifi', 'parking', 'check-in', 'pets'.
    `topic` VARCHAR(120) NOT NULL,
    -- the canonical guest question this fact answers.
    `question` TEXT NULL,
    -- the canonical, guest-shareable answer.
    `answer` MEDIUMTEXT NULL,
    -- how often this has been asked/seen (drives "asked a lot" prioritization).
    `frequency` INT NOT NULL DEFAULT 1,
    -- pending | approved | rejected. Only 'approved' feeds the bot context.
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'nightly_audit' | 'manual'
    `source` VARCHAR(30) NOT NULL DEFAULT 'nightly_audit',
    `sampleThreadId` BIGINT NULL,
    `reviewedByUserId` INT NULL,
    `lastSeenAt` DATETIME NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_alf_scope` (`scope`),
    INDEX `idx_alf_listing` (`listingId`),
    INDEX `idx_alf_status` (`status`),
    INDEX `idx_alf_topic` (`topic`),
    INDEX `idx_alf_freq` (`frequency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
