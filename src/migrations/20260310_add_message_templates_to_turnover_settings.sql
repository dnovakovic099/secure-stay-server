-- Add message template columns to turnover_settings
ALTER TABLE turnover_settings 
ADD COLUMN pre_stay_message_template TEXT NULL,
ADD COLUMN post_stay_message_template TEXT NULL;
