-- Migration: Add otherAmenities column to property_info table
-- Date: 2024-12-20

ALTER TABLE property_info
ADD COLUMN otherAmenities TEXT NULL;
