-- Migration file for adding amenities acknowledgment checkboxes
-- Date: 2025-12-12

-- Add acknowledgeAmenitiesAccurate column to property_info table
ALTER TABLE property_info 
ADD COLUMN acknowledge_amenities_accurate BOOLEAN NULL;

-- Add acknowledgeSecurityCamerasDisclosed column to property_info table
ALTER TABLE property_info 
ADD COLUMN acknowledge_security_cameras_disclosed BOOLEAN NULL;
