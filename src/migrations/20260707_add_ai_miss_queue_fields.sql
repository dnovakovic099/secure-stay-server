-- "Replies to fix" queue: note + root-cause category for AI misses, and a
-- resolved marker so the queue shrinks as humans work through it.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `aiReplyQualityNote` VARCHAR(255) NULL AFTER `aiReplyQuality`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'aiReplyQualityNote'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `aiReplyQualityCategory` VARCHAR(30) NULL AFTER `aiReplyQualityNote`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'aiReplyQualityCategory'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `missResolvedAt` DATETIME NULL AFTER `aiReplyQualityCategory`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'missResolvedAt'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
