ALTER TABLE issues_updates
ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'securestay',
ADD COLUMN `slackMessageTs` VARCHAR(50) NULL,
ADD INDEX `idx_issues_updates_slack_ts` (`slackMessageTs`);
