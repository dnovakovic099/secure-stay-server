SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `maintenance` ADD COLUMN `status` varchar(255) NULL DEFAULT ''Scheduled''',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'maintenance'
    AND COLUMN_NAME = 'status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `maintenance`
SET `status` = 'Scheduled'
WHERE `status` IS NULL OR `status` = '';
