-- Add missing employee profile columns
ALTER TABLE employees
    ADD COLUMN phone VARCHAR(30) NULL,
    ADD COLUMN birthday DATE NULL,
    ADD COLUMN schedule VARCHAR(255) NULL,
    ADD COLUMN slack_id VARCHAR(100) NULL,
    ADD COLUMN payment_method VARCHAR(50) NULL,
    ADD COLUMN payment_method_other VARCHAR(100) NULL,
    ADD COLUMN payment_schedule VARCHAR(50) NULL,
    ADD COLUMN payment_info TEXT NULL;
