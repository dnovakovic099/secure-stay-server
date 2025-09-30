-- Migration: Add propertyId column to client_management table
-- Date: 2024-12-19
-- Description: Add propertyId field to associate clients with specific properties

-- Add propertyId column to client_management table
ALTER TABLE `client_management` 
ADD COLUMN `propertyId` INT NULL AFTER `notes`;

-- Add index for better query performance
ALTER TABLE `client_management` 
ADD INDEX `idx_propertyId` (`propertyId`);

-- Add foreign key constraint to reference the listing_info table
-- Note: This assumes the listing_info table exists and has a listing_id column
-- ALTER TABLE `client_management` 
-- ADD CONSTRAINT `fk_client_property` 
-- FOREIGN KEY (`propertyId`) REFERENCES `listing_info`(`listing_id`) 
-- ON DELETE SET NULL ON UPDATE CASCADE;
