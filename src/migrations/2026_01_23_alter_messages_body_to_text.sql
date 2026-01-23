-- Migration: Alter messages.body column from VARCHAR(255) to TEXT
-- Reason: Guest messages can exceed 255 characters, causing "Data too long for column 'body'" error

ALTER TABLE messages MODIFY COLUMN body TEXT;
