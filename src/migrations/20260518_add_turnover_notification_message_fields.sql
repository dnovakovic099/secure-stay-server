SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `reservation_detail_pre_stay_audit` ADD COLUMN `notificationMessage` TEXT NULL AFTER `notificationError`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reservation_detail_pre_stay_audit'
    AND COLUMN_NAME = 'notificationMessage'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `reservation_detail_post_stay_audit` ADD COLUMN `cleanerNotificationMessage` TEXT NULL AFTER `cleanerNotificationError`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reservation_detail_post_stay_audit'
    AND COLUMN_NAME = 'cleanerNotificationMessage'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
