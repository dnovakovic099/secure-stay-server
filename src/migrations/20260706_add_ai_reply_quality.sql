SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `aiReplyQuality` VARCHAR(20) NULL AFTER `replyRelevanceNote`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'aiReplyQuality'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
