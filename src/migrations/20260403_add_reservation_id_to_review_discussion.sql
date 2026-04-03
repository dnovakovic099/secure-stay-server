-- Add reservation_id column to review_discussion_messages
-- This allows discussions to be keyed by reservationId instead of reviewId,
-- so the Updates & Discussion panel works even when no review is linked.

ALTER TABLE review_discussion_messages
  MODIFY COLUMN review_id VARCHAR(255) NULL,
  ADD COLUMN reservation_id BIGINT NULL AFTER review_id,
  ADD INDEX idx_review_discussion_reservation (reservation_id);
