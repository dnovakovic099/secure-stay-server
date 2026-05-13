SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `expense` ADD COLUMN `paymentDetails` TEXT NULL AFTER `paymentMethod`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expense'
    AND COLUMN_NAME = 'paymentDetails'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
