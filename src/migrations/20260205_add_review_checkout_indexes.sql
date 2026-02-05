-- Migration: Add indexes to review_checkout table for performance
-- Date: 2026-02-05

-- Index on status (heavily filtered in tab-based queries)
CREATE INDEX idx_review_checkout_status ON review_checkout(status);

-- Index on sevenDaysAfterCheckout (used in date comparisons for follow-up logic)
CREATE INDEX idx_review_checkout_seven_days ON review_checkout(sevenDaysAfterCheckout);

-- Index on calledOnceDate (used in Called Once status filtering)
CREATE INDEX idx_review_checkout_called_once ON review_checkout(calledOnceDate);

-- Composite index for common query pattern (status + sevenDaysAfterCheckout)
CREATE INDEX idx_review_checkout_status_seven_days ON review_checkout(status, sevenDaysAfterCheckout);

-- Index on createdAt for ordering
CREATE INDEX idx_review_checkout_created_at ON review_checkout(createdAt);
