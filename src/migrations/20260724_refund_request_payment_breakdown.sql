SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `refundBreakdownEnabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `refundAmount`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'refundBreakdownEnabled'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `refundBreakdown` LONGTEXT NULL AFTER `refundBreakdownEnabled`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'refundBreakdown'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
