-- Quo (OpenPhone SMS) suggestions share ai_message_suggestions with the Hostify
-- inbox so the whole audit/analytics pipeline (reply capture, judging, coverage,
-- confidence safety) works for both. `source` discriminates the two; for quo
-- rows threadId = quo_conversations.id and messageId = quo_messages.id, with
-- the string OpenPhone conversation key kept in quoConversationId for joins.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT ''hostify'' AFTER `id`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_message_suggestions' AND COLUMN_NAME = 'source'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `quoConversationId` VARCHAR(64) NULL AFTER `source`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_message_suggestions' AND COLUMN_NAME = 'quoConversationId'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_ai_suggestions_source` ON `ai_message_suggestions` (`source`, `generatedAt`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_message_suggestions' AND INDEX_NAME = 'idx_ai_suggestions_source'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
