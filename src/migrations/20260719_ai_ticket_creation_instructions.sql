-- Ticket-creation instruction overrides + unified ticket categories.
--
-- Backs two changes:
--   1. Surface the previously-hardcoded detector prompts in the AI Assistant
--      Settings page so SS admins can edit them without a redeploy. Field-level
--      admin gate lives in the controller; NULL columns fall back to the
--      compiled defaults in AIDetectorInstructions.ts (identical to the prior
--      hardcoded strings, so behavior is unchanged until an admin edits one).
--   2. Merge action_item / guest_issue category lists into a single
--      `ticketCategories` column. The two legacy columns are kept untouched
--      for rollback safety and are no longer written to by the UI.
--
-- Idempotent — safe to re-run (matches the pattern in
-- 20260716_ai_settings_rules_and_categories.sql).

-- Task 1: admin-editable ticket-creation instructions
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `detectorSystemPersona` TEXT NULL AFTER `detectionFeedback`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'detectorSystemPersona');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `detectionExclusionRules` TEXT NULL AFTER `detectorSystemPersona`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'detectionExclusionRules');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `detectionConfidenceFloor` DECIMAL(3,2) NULL AFTER `detectionExclusionRules`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'detectionConfidenceFloor');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `quoDetectorSystemPrompt` TEXT NULL AFTER `detectionConfidenceFloor`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'quoDetectorSystemPrompt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `betaDetectorSystemPrompt` TEXT NULL AFTER `quoDetectorSystemPrompt`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'betaDetectorSystemPrompt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Separate audit trail for the admin-only instruction edits.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `instructionsUpdatedAt` TIMESTAMP NULL AFTER `betaDetectorSystemPrompt`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'instructionsUpdatedAt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `instructionsUpdatedByName` VARCHAR(255) NULL AFTER `instructionsUpdatedAt`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'instructionsUpdatedByName');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Task 2: unified ticket categories (replaces actionItemCategories +
-- guestIssueCategories in the UI; legacy columns kept for rollback).
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `ticketCategories` MEDIUMTEXT NULL AFTER `guestIssueCategories`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'ticketCategories');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
