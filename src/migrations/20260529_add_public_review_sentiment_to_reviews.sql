ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS public_review_sentiment VARCHAR(20) NULL AFTER publicReview,
    ADD COLUMN IF NOT EXISTS public_review_sentiment_reason TEXT NULL AFTER public_review_sentiment;
