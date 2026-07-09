-- Migration: Add From +50 flag to expense table
ALTER TABLE `expense`
ADD COLUMN `fromPlus50` TINYINT(1) NOT NULL DEFAULT 0 AFTER `fromClaimsFee`;
