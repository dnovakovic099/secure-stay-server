SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `contact` ADD COLUMN `managedBy` VARCHAR(255) NULL AFTER `rate`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contact'
    AND COLUMN_NAME = 'managedBy'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `contact` ADD COLUMN `workSchedule` VARCHAR(255) NULL AFTER `managedBy`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contact'
    AND COLUMN_NAME = 'workSchedule'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `contact` ADD COLUMN `payoutDetails` TEXT NULL AFTER `paymentScheduleType`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contact'
    AND COLUMN_NAME = 'payoutDetails'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
