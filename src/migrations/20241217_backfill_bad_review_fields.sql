-- Migration: Backfill existing bad_reviews with publicReview and rating from reviews table
-- Date: 2024-12-17
-- Description: For existing bad_reviews records, populate publicReview and rating 
--              from the reviews table based on reservationInfo relationship

-- Update existing bad_reviews with data from reviews table
-- Only updates records where isManuallyEntered is false or null (not manually entered)
UPDATE bad_reviews br
JOIN reservation_info ri ON br.reservationInfoId = ri.id
JOIN reviews r ON r.reservationId = ri.id
SET 
    br.publicReview = r.publicReview,
    br.rating = r.rating,
    br.isManuallyEntered = false,
    br.updatedAt = NOW(),
    br.updatedBy = 'migration-backfill'
WHERE 
    (br.isManuallyEntered IS NULL OR br.isManuallyEntered = false)
    AND (br.publicReview IS NULL OR br.rating IS NULL)
    AND r.publicReview IS NOT NULL;
