-- Extend ai_messaging_settings to back the redesigned AI Assistant Settings tab.
--
-- New columns:
--   communicationRuleEntries — JSON list of per-topic rules ({id, topic, rule,
--                              appliesTo}). Preferred over the free-text
--                              `communicationRules` column; the old column is
--                              kept for back-compat.
--   capabilityLimits         — short spec of what the AI is allowed to do; fed
--                              into the prompt and used to reject learned
--                              instructions the AI can't reliably execute.
--   useListingDataForTopics  — JSON list of topic slugs that must always be
--                              answered from live listing/reservation data
--                              instead of a learned fact (staleness guard).
--   actionItemCategories     — JSON list of managed action-item categories
--                              ({id, name, description, examples, autoCreate}).
--   guestIssueCategories     — same, for guest-issue detection.
--
-- Each add is guarded by INFORMATION_SCHEMA so re-running the migration is safe
-- (matches the pattern used by 20260710_admin_insights.sql).

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `communicationRuleEntries` MEDIUMTEXT NULL AFTER `communicationRules`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'communicationRuleEntries');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `capabilityLimits` TEXT NULL AFTER `topicsToAvoid`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'capabilityLimits');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `useListingDataForTopics` TEXT NULL AFTER `capabilityLimits`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'useListingDataForTopics');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `actionItemCategories` MEDIUMTEXT NULL AFTER `actionItemRules`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'actionItemCategories');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_messaging_settings` ADD COLUMN `guestIssueCategories` MEDIUMTEXT NULL AFTER `guestIssueRules`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'guestIssueCategories');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
