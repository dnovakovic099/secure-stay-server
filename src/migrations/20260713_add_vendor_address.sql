SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `contact` ADD COLUMN `vendorAddress` VARCHAR(255) NULL AFTER `source`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contact'
    AND COLUMN_NAME = 'vendorAddress'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `vendor_profiles` ADD COLUMN `vendorAddress` VARCHAR(255) NULL AFTER `source`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vendor_profiles'
    AND COLUMN_NAME = 'vendorAddress'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
