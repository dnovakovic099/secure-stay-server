-- Add startDate column to listing_info table
-- This stores when the listing was first priced (when basePrice changed from 3000)

ALTER TABLE listing_info 
ADD COLUMN startDate DATE NULL;
