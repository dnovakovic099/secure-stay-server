-- Add privateReview column to reviews table
ALTER TABLE reviews
    ADD COLUMN private_review TEXT NULL;
