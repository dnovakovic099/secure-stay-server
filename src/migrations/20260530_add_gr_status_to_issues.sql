-- Add a separate Guest Relations status while preserving issues.status as IR Status.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE issues ADD COLUMN gr_status ENUM(''New'', ''In Progress'', ''Overdue'', ''Completed'', ''Need Help'', ''Scheduled'') NULL DEFAULT ''New'' AFTER status',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND COLUMN_NAME = 'gr_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE issues
SET gr_status = 'New'
WHERE gr_status IS NULL OR gr_status = '';

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_issues_gr_status ON issues (gr_status)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'issues'
    AND INDEX_NAME = 'idx_issues_gr_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
