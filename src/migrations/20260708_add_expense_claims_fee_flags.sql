-- Migration: Add claims fee and rent deduction flags to expense table
-- Date: 2026-07-08

ALTER TABLE expense
ADD COLUMN fromClaimsFee TINYINT(1) NOT NULL DEFAULT 0,
ADD COLUMN deductFromRent TINYINT(1) NOT NULL DEFAULT 0;
