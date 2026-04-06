ALTER TABLE escalation_settings ADD COLUMN overdue_alert_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE escalation_settings ADD COLUMN follow_up_reminders_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE escalation_settings ADD COLUMN daily_check_in_enabled BOOLEAN NOT NULL DEFAULT true;
