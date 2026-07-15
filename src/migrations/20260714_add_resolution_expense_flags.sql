-- Migration: Add accounting flag fields to resolutions
-- Date: 2026-07-14

ALTER TABLE `resolutions`
ADD COLUMN `llCover` TINYINT(1) NOT NULL DEFAULT 0 AFTER `amountToPayout`,
ADD COLUMN `fromClaimsFee` TINYINT(1) NOT NULL DEFAULT 0 AFTER `llCover`,
ADD COLUMN `fromPlus50` TINYINT(1) NOT NULL DEFAULT 0 AFTER `fromClaimsFee`,
ADD COLUMN `deductFromRent` TINYINT(1) NOT NULL DEFAULT 0 AFTER `fromPlus50`;
