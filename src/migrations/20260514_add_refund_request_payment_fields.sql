SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `paymentMethod` VARCHAR(255) NULL AFTER `status`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'paymentMethod'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `paymentDetails` TEXT NULL AFTER `paymentMethod`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'paymentDetails'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `refund_request_info` ADD COLUMN `chargeToClient` TINYINT(1) NOT NULL DEFAULT 0 AFTER `paymentDetails`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_request_info'
    AND COLUMN_NAME = 'chargeToClient'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
