-- Add welcome notification tracking fields to client_properties table
-- These fields track when welcome SMS and Email notifications were sent

ALTER TABLE client_properties
ADD COLUMN welcome_email_sent_at TIMESTAMP NULL,
ADD COLUMN welcome_sms_sent_at TIMESTAMP NULL;
