-- Migration: Add publicReview, rating, and isManuallyEntered columns to bad_reviews table
-- Date: 2024-12-17

ALTER TABLE bad_reviews
ADD COLUMN publicReview TEXT NULL,
ADD COLUMN rating INT NULL,
ADD COLUMN isManuallyEntered BOOLEAN DEFAULT FALSE;
