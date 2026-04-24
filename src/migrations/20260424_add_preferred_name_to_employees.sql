-- Add missing employee columns that exist in entity but not in database
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(100) NULL AFTER slack_user_id,
    ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) NULL AFTER job_title,
    ADD COLUMN IF NOT EXISTS hired_from VARCHAR(50) NULL AFTER job_type,
    ADD COLUMN IF NOT EXISTS hired_from_other VARCHAR(100) NULL AFTER hired_from,
    ADD COLUMN IF NOT EXISTS employee_type VARCHAR(50) NULL AFTER hired_from_other,
    ADD COLUMN IF NOT EXISTS employee_number_seq INT NULL AFTER employee_number,
    ADD COLUMN IF NOT EXISTS payment_day VARCHAR(20) NULL AFTER payment_schedule,
    ADD COLUMN IF NOT EXISTS payment_recurrence VARCHAR(20) NULL AFTER payment_day,
    ADD COLUMN IF NOT EXISTS payment_start_date DATE NULL AFTER payment_recurrence;
