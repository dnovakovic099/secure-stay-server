SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `archived` TINYINT(1) NOT NULL DEFAULT 0 AFTER `updated_by`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'archived'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `archived_at` DATETIME NULL AFTER `archived`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'archived_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `archived_by` VARCHAR(255) NULL AFTER `archived_at`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'archived_by'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
