-- Migration: Add calledOnceDate column to review_checkout table
-- Description: This column tracks when the "Called Once" status was set

ALTER TABLE review_checkout ADD COLUMN calledOnceDate VARCHAR(255) NULL;
