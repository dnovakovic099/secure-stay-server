SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `vendor_profiles` ADD COLUMN `firstName` VARCHAR(255) NULL AFTER `name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_profiles'
    AND COLUMN_NAME = 'firstName'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `vendor_profiles` ADD COLUMN `lastName` VARCHAR(255) NULL AFTER `firstName`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_profiles'
    AND COLUMN_NAME = 'lastName'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `vendor_profiles` ADD COLUMN `preferredName` VARCHAR(255) NULL AFTER `lastName`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_profiles'
    AND COLUMN_NAME = 'preferredName'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `vendor_profiles` ADD COLUMN `dateStarted` DATE NULL AFTER `vendorAddress`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_profiles'
    AND COLUMN_NAME = 'dateStarted'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
