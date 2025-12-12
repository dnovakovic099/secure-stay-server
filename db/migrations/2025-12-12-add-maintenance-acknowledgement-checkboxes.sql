-- Migration: Add maintenance acknowledgement checkboxes
-- Date: 2024-12-12

-- Add acknowledgeMaintenanceResponsibility column to property_vendor_management table
ALTER TABLE property_vendor_management 
ADD COLUMN acknowledgeMaintenanceResponsibility BOOLEAN NULL;

-- Add authorizeLuxuryLodgingAction column to property_vendor_management table
ALTER TABLE property_vendor_management 
ADD COLUMN authorizeLuxuryLodgingAction BOOLEAN NULL;
