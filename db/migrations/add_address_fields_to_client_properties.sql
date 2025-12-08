-- Migration: Add address component fields to client_properties table
-- Date: 2025-11-30
-- Description: Adds streetAddress, city, state, country, zipCode, latitude, and longitude fields
--              to support Google Places Autocomplete integration

-- Add new columns to client_properties table
ALTER TABLE client_properties
ADD COLUMN IF NOT EXISTS "streetAddress" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "city" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "state" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "country" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "zipCode" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10, 6),
ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(11, 6);

-- Add comments to describe the columns
COMMENT ON COLUMN client_properties."streetAddress" IS 'Street address extracted from Google Places (street number + route)';
COMMENT ON COLUMN client_properties."city" IS 'City/locality from Google Places';
COMMENT ON COLUMN client_properties."state" IS 'State/region from Google Places (administrative area level 1)';
COMMENT ON COLUMN client_properties."country" IS 'Country name from Google Places';
COMMENT ON COLUMN client_properties."zipCode" IS 'Postal code from Google Places';
COMMENT ON COLUMN client_properties."latitude" IS 'Geographic latitude coordinate';
COMMENT ON COLUMN client_properties."longitude" IS 'Geographic longitude coordinate';

-- Optional: Create indexes for commonly queried fields
CREATE INDEX IF NOT EXISTS idx_client_properties_city ON client_properties("city");
CREATE INDEX IF NOT EXISTS idx_client_properties_state ON client_properties("state");
CREATE INDEX IF NOT EXISTS idx_client_properties_country ON client_properties("country");
CREATE INDEX IF NOT EXISTS idx_client_properties_location ON client_properties("latitude", "longitude");












