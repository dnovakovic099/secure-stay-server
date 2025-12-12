-- Migration: Add emergencyBackUpCode column to property_info table
-- Date: 2024-12-12

-- Add emergencyBackUpCode column to property_info table
ALTER TABLE property_info 
ADD COLUMN emergencyBackUpCode TEXT NULL;

