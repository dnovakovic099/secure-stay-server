SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `refundCategory` VARCHAR(255) NULL AFTER `explaination`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'refundCategory'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `approvedBy` VARCHAR(255) NULL AFTER `status`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'approvedBy'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
