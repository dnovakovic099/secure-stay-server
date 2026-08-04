-- Enforce that no two Issues share the same aiSourceRef. This is defense-in-depth
-- against races that slip past the reservation-scoped MySQL lock in the detectors.
-- MySQL treats each NULL in a UNIQUE index as distinct, so manual tickets (which
-- leave aiSourceRef NULL) are unaffected.
--
-- We only add the index if:
--   1) it does not already exist, AND
--   2) no existing rows would violate it.
-- If duplicates are present, the migration logs a message and no-ops — a follow-up
-- cleanup script can merge or close the duplicates before re-running.

SET @has_index := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'issues'
    AND index_name = 'uniq_issues_aiSourceRef'
);

SET @dup_count := (
  SELECT COUNT(*) FROM (
    SELECT aiSourceRef
    FROM issues
    WHERE aiSourceRef IS NOT NULL AND aiSourceRef <> ''
    GROUP BY aiSourceRef
    HAVING COUNT(*) > 1
  ) x
);

SET @sql := IF(
  @has_index = 0 AND @dup_count = 0,
  'ALTER TABLE `issues` ADD UNIQUE INDEX `uniq_issues_aiSourceRef` (`aiSourceRef`)',
  CONCAT(
    'SELECT ',
    IF(@has_index > 0,
       '''skip: uniq_issues_aiSourceRef already exists''',
       CONCAT('''skip: ', @dup_count, ' duplicate aiSourceRef value(s) present — clean up before enforcing uniqueness''')
    )
  )
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
