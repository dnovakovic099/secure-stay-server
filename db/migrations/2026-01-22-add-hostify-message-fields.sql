-- Migration: Add Hostify fields to messages table
-- Date: 2026-01-22
-- Description: Adds threadId, listingId, guestId, and source columns to support Hostify message integration

-- Add Hostify-specific fields
ALTER TABLE `messages` 
ADD COLUMN `threadId` VARCHAR(255) NULL,
ADD COLUMN `listingId` VARCHAR(255) NULL,
ADD COLUMN `guestId` VARCHAR(255) NULL,
ADD COLUMN `source` VARCHAR(50) DEFAULT 'hostaway';

-- Make conversationId nullable (Hostify uses threadId instead)
ALTER TABLE `messages` 
MODIFY COLUMN `conversationId` INT NULL;

-- Add index for efficient querying by source and answered status
CREATE INDEX `idx_messages_source_answered` ON `messages` (`source`, `answered`);

-- Add index for threadId lookups
CREATE INDEX `idx_messages_threadId` ON `messages` (`threadId`);
