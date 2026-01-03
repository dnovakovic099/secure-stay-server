ALTER TABLE client_ticket_updates
ADD COLUMN source VARCHAR(10) DEFAULT 'app',
ADD COLUMN `slackMessageTs` VARCHAR(50) NULL;
