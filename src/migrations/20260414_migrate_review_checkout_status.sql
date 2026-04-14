-- Migrate review_checkout status from old granular values to simplified New/In Progress/Completed

UPDATE review_checkout SET status = 'New'
WHERE status = 'To Call';

UPDATE review_checkout SET status = 'In Progress'
WHERE status IN ('Called Once', 'Follow up (No answer)', 'Follow up (Review check)', 'No further action required', 'Issue', 'Launch');

UPDATE review_checkout SET status = 'Completed'
WHERE status IN ('Closed - 5 Star', 'Closed - Bad Review', 'Closed - No Review', 'Closed - Trapped');
