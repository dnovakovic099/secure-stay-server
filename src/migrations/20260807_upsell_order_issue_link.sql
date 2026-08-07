-- Link Requests & Orders ↔ Guest Issues, and track generated Resolutions.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `issue_id` INT NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'issue_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `resolution_id` INT NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'resolution_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `upsell_orders` ADD COLUMN `upsell_id` INT NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND COLUMN_NAME = 'upsell_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `issues` ADD COLUMN `upsell_order_id` INT NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'upsell_order_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_upsell_orders_issue_id` ON `upsell_orders` (`issue_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'upsell_orders'
    AND INDEX_NAME = 'idx_upsell_orders_issue_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `idx_issues_upsell_order_id` ON `issues` (`upsell_order_id`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND INDEX_NAME = 'idx_issues_upsell_order_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
