SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `auditMatchQuality` VARCHAR(20) NULL AFTER `replySemanticSimilarity`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_message_suggestions'
    AND COLUMN_NAME = 'auditMatchQuality'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
