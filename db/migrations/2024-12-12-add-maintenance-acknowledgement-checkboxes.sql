-- Migration: Add management acknowledgement checkboxes
-- Date: 2024-12-12

-- Add acknowledgeMaintenanceResponsibility column to property_vendor_management table
ALTER TABLE property_vendor_management 
ADD COLUMN acknowledgeMaintenanceResponsibility BOOLEAN NULL;

-- Add authorizeLuxuryLodgingAction column to property_vendor_management table
ALTER TABLE property_vendor_management 
ADD COLUMN authorizeLuxuryLodgingAction BOOLEAN NULL;

-- Add acknowledgeNoGuestContact column to property_info table (Management Notes section)
ALTER TABLE property_info 
ADD COLUMN acknowledgeNoGuestContact BOOLEAN NULL;

-- Add acknowledgeNoPropertyAccess column to property_info table (Management Notes section)
ALTER TABLE property_info 
ADD COLUMN acknowledgeNoPropertyAccess BOOLEAN NULL;

-- Add acknowledgeNoDirectTransactions column to property_info table (Management Notes section)
ALTER TABLE property_info 
ADD COLUMN acknowledgeNoDirectTransactions BOOLEAN NULL;
