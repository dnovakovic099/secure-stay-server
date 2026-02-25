-- Add slack_user_id column to employees table
ALTER TABLE employees
ADD COLUMN slack_user_id VARCHAR(50) NULL AFTER bonuses;
