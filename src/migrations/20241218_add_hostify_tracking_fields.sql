-- Migration: Add Hostify publish tracking fields to client_properties table
-- Date: 2024-12-18

ALTER TABLE client_properties
ADD COLUMN hostifyPublishStatus VARCHAR(50) NULL,
ADD COLUMN hostifyPublishError TEXT NULL,
ADD COLUMN hostifyCompletedSteps TEXT NULL,
ADD COLUMN hostifyLastPublishAttempt TIMESTAMP NULL;
