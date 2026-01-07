-- Migration: Add Smart Lock Enhancement Fields
-- Date: 2026-01-06
-- Description: Add hoursAfterCheckout to property_lock_settings and source/date fields to access_codes

-- Add hoursAfterCheckout column to property_lock_settings
ALTER TABLE property_lock_settings 
ADD COLUMN hours_after_checkout INT DEFAULT 3;

-- Add source column to access_codes (manual or automatic)
ALTER TABLE access_codes 
ADD COLUMN source ENUM('manual', 'automatic') DEFAULT 'manual';

-- Add check_in_date column to access_codes
ALTER TABLE access_codes 
ADD COLUMN check_in_date DATE NULL;

-- Add check_out_date column to access_codes
ALTER TABLE access_codes 
ADD COLUMN check_out_date DATE NULL;

-- Add expires_at column to access_codes
ALTER TABLE access_codes 
ADD COLUMN expires_at TIMESTAMP NULL;
