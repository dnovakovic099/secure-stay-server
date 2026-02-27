-- Add profile photo column to employees
ALTER TABLE employees ADD COLUMN profile_photo VARCHAR(500) NULL AFTER slack_user_id;
