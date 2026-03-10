-- Add message template columns to turnover_settings
ALTER TABLE turnover_settings 
ADD COLUMN IF NOT EXISTS pre_stay_message_template TEXT NULL,
ADD COLUMN IF NOT EXISTS post_stay_message_template TEXT NULL;
