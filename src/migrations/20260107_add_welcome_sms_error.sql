-- Add welcome_sms_error field to track SMS sending failures
-- This field stores the error message from OpenPhone when SMS fails to send

ALTER TABLE client_properties
ADD COLUMN welcome_sms_error TEXT NULL;
