-- Migration: Admin Insights correction audit columns
-- Date: 2026-07-18
--
-- Lets an admin (or any allowlisted user of the Admin Insights page) correct
-- an entry that was originally created by another user. We keep the audit
-- trail so the correction is visible in the log:
--   correctedByUserId  — who applied the correction
--   correctedAt        — when
--
-- Applied to the three "training event" tables surfaced in the Admin Insights
-- feedback log. Additive & idempotent.

ALTER TABLE `ai_message_feedback`
    ADD COLUMN IF NOT EXISTS `correctedByUserId` INT NULL,
    ADD COLUMN IF NOT EXISTS `correctedAt` DATETIME NULL;

ALTER TABLE `ai_learned_facts`
    ADD COLUMN IF NOT EXISTS `correctedByUserId` INT NULL,
    ADD COLUMN IF NOT EXISTS `correctedAt` DATETIME NULL;

ALTER TABLE `ai_learning_prompts`
    ADD COLUMN IF NOT EXISTS `correctedByUserId` INT NULL,
    ADD COLUMN IF NOT EXISTS `correctedAt` DATETIME NULL;
