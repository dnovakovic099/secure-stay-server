-- Migration: Add tech fee fields to listing_details table
-- Date: 2024-12-28

ALTER TABLE listing_details
ADD COLUMN tech_fee BOOLEAN DEFAULT false;

ALTER TABLE listing_details
ADD COLUMN tech_fee_amount DECIMAL(10,2) NULL;
