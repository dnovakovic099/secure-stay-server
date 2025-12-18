-- Add hostifyListingId field to client_properties table
-- This field stores the Hostify-specific listing ID returned from the location step
-- Allows resume-from-failure functionality by preserving listing ID across retries

ALTER TABLE client_properties 
ADD COLUMN hostifyListingId VARCHAR(255) NULL;