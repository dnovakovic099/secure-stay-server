SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `reservation_info` ADD COLUMN `base_price` FLOAT NULL AFTER `cleaningFee`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reservation_info'
    AND COLUMN_NAME = 'base_price'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
