-- Replace the removed issue status with the active-work status.

UPDATE issues
SET status = 'In Progress'
WHERE status = 'Overdue';
