-- Add Asana task tracking fields to client_properties table
-- These fields track Asana task creation status, URL, and any errors

ALTER TABLE client_properties
ADD COLUMN asana_task_id VARCHAR(255) NULL,
ADD COLUMN asana_task_url VARCHAR(500) NULL,
ADD COLUMN asana_task_created_at TIMESTAMP NULL,
ADD COLUMN asana_task_error TEXT NULL;
