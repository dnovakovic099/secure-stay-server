-- Migration: Add guest_name field to messages table
-- Date: 2026-01-23
-- Description: Adds guestName column to store guest names from Hostify webhook

ALTER TABLE `messages` 
ADD COLUMN `guestName` VARCHAR(255) NULL;
