ALTER TABLE turnover_settings
ADD COLUMN pre_stay_recipient_ids JSON NULL,
ADD COLUMN pre_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
ADD COLUMN pre_stay_offset_minutes INT NULL DEFAULT 0,
ADD COLUMN post_stay_recipient_ids JSON NULL,
ADD COLUMN post_stay_schedule_mode VARCHAR(50) NULL DEFAULT 'auto',
ADD COLUMN post_stay_offset_minutes INT NULL DEFAULT 0,
ADD COLUMN same_day_combined_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN same_day_combined_recipient_ids JSON NULL,
ADD COLUMN same_day_combined_message_template TEXT NULL,
ADD COLUMN same_day_schedule_mode VARCHAR(50) NULL DEFAULT 'post-stay',
ADD COLUMN same_day_offset_minutes INT NULL DEFAULT 0;
