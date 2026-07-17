-- Ops Radar daily digest recipients: one morning email with the open
-- critical/high alerts, sent after the 6:30am deep scan. Empty = no email.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `opsAlertEmails` TEXT NULL AFTER `paymentAlertEmails`;
