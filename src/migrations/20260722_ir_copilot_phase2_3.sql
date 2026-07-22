-- IR Copilot Phase 2/3: global automation toggles on AI messaging settings.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_messaging_settings ADD COLUMN irAutoAckEnabled TINYINT NOT NULL DEFAULT 0',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_messaging_settings'
    AND COLUMN_NAME = 'irAutoAckEnabled'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_messaging_settings ADD COLUMN irAutoAssignEnabled TINYINT NOT NULL DEFAULT 0',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_messaging_settings'
    AND COLUMN_NAME = 'irAutoAssignEnabled'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_messaging_settings ADD COLUMN irStaleHoursInHouse INT NOT NULL DEFAULT 2',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_messaging_settings'
    AND COLUMN_NAME = 'irStaleHoursInHouse'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_messaging_settings ADD COLUMN irAutoAckListingIds TEXT NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_messaging_settings'
    AND COLUMN_NAME = 'irAutoAckListingIds'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
