SET @database_name = DATABASE();

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @database_name
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'flagDismissedAt'
);

SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE `refund_request_info` ADD COLUMN `flagDismissedAt` TIMESTAMP NULL AFTER `deletedBy`',
  'SELECT ''flagDismissedAt already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @database_name
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'flagDismissedBy'
);

SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE `refund_request_info` ADD COLUMN `flagDismissedBy` VARCHAR(255) NULL AFTER `flagDismissedAt`',
  'SELECT ''flagDismissedBy already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
