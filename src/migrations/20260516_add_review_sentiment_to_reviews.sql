ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS review_sentiment VARCHAR(20) NULL AFTER private_review,
    ADD COLUMN IF NOT EXISTS review_sentiment_reason TEXT NULL AFTER review_sentiment;
