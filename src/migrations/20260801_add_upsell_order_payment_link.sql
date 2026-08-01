SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `payment_link` VARCHAR(2048) NULL AFTER `payment_method`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'payment_link'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
