-- Normalize SS User department labels and allow employee department labels to mirror them.
ALTER TABLE employees MODIFY COLUMN department VARCHAR(100) NOT NULL;

UPDATE employees
SET department = CASE
    WHEN department IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions') THEN 'Maintenance'
    WHEN department = 'Admin' THEN 'Administrative'
    ELSE department
END;

UPDATE departments
SET name = 'Maintenance'
WHERE name IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions')
  AND NOT EXISTS (
      SELECT 1 FROM (SELECT id FROM departments WHERE name = 'Maintenance' AND deletedAt IS NULL) existing_maintenance
  );

UPDATE user_departments source_ud
INNER JOIN departments source_dept ON source_dept.id = source_ud.departmentId
INNER JOIN departments target_dept ON target_dept.name = 'Maintenance' AND target_dept.deletedAt IS NULL
SET source_ud.departmentId = target_dept.id
WHERE source_dept.name IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions')
  AND source_dept.deletedAt IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM (
          SELECT userId, departmentId FROM user_departments
      ) existing_ud
      WHERE existing_ud.userId = source_ud.userId
        AND existing_ud.departmentId = target_dept.id
  );

DELETE source_ud FROM user_departments source_ud
INNER JOIN departments source_dept ON source_dept.id = source_ud.departmentId
INNER JOIN departments target_dept ON target_dept.name = 'Maintenance' AND target_dept.deletedAt IS NULL
INNER JOIN user_departments target_ud
    ON target_ud.userId = source_ud.userId
   AND target_ud.departmentId = target_dept.id
WHERE source_dept.name IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions')
  AND source_dept.deletedAt IS NULL;

DELETE FROM departments
WHERE name IN ('Issue Resolution', 'Issue Resolutions', 'Issues Resolution', 'Issues Resolutions')
  AND EXISTS (
      SELECT 1 FROM (SELECT id FROM departments WHERE name = 'Maintenance' AND deletedAt IS NULL) existing_maintenance
  );

UPDATE departments
SET name = 'Administrative'
WHERE name = 'Admin'
  AND NOT EXISTS (
      SELECT 1 FROM (SELECT id FROM departments WHERE name = 'Administrative' AND deletedAt IS NULL) existing_administrative
  );

UPDATE user_departments source_ud
INNER JOIN departments source_dept ON source_dept.id = source_ud.departmentId
INNER JOIN departments target_dept ON target_dept.name = 'Administrative' AND target_dept.deletedAt IS NULL
SET source_ud.departmentId = target_dept.id
WHERE source_dept.name = 'Admin'
  AND source_dept.deletedAt IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM (
          SELECT userId, departmentId FROM user_departments
      ) existing_ud
      WHERE existing_ud.userId = source_ud.userId
        AND existing_ud.departmentId = target_dept.id
  );

DELETE source_ud FROM user_departments source_ud
INNER JOIN departments source_dept ON source_dept.id = source_ud.departmentId
INNER JOIN departments target_dept ON target_dept.name = 'Administrative' AND target_dept.deletedAt IS NULL
INNER JOIN user_departments target_ud
    ON target_ud.userId = source_ud.userId
   AND target_ud.departmentId = target_dept.id
WHERE source_dept.name = 'Admin'
  AND source_dept.deletedAt IS NULL;

DELETE FROM departments
WHERE name = 'Admin'
  AND EXISTS (
      SELECT 1 FROM (SELECT id FROM departments WHERE name = 'Administrative' AND deletedAt IS NULL) existing_administrative
  );
