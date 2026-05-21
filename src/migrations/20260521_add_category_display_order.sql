SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `category` ADD COLUMN `displayOrder` INT NULL AFTER `hostawayId`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'category'
    AND COLUMN_NAME = 'displayOrder'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
