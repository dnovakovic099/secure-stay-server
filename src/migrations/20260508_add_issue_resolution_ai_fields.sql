-- Adds AI-analyzed resolution metadata to issue tickets.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE issues ADD COLUMN ai_resolution_status VARCHAR(32) NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'ai_resolution_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE issues ADD COLUMN ai_guest_sentiment VARCHAR(32) NULL',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'ai_guest_sentiment'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
