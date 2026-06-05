-- Split issue resolution notes into IR/GR sections and store AI manager assessment separately.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE issues ADD COLUMN guest_relations_resolution TEXT NULL AFTER resolution',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'guest_relations_resolution'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE issues ADD COLUMN manager_ai_feedback TEXT NULL AFTER manager_feedback',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'manager_ai_feedback'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
