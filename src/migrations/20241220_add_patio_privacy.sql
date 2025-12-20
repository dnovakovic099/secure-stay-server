-- Migration: Add patioPrivacy column to property_info table
-- Date: 2024-12-20

ALTER TABLE property_info
ADD COLUMN patioPrivacy VARCHAR(255) NULL;
