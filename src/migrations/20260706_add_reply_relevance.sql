SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `replyRelevance` VARCHAR(20) NULL AFTER `auditMatchQuality`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'replyRelevance'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `replyRelevanceNote` VARCHAR(255) NULL AFTER `replyRelevance`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'replyRelevanceNote'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
