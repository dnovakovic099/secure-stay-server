-- Migration: Map accounting contractors to vendor profiles
ALTER TABLE `contractor_info`
ADD COLUMN IF NOT EXISTS `vendorProfileId` INT NULL;
