-- Add visibility field to review_checkout for pre-review visibility tracking
ALTER TABLE review_checkout ADD COLUMN visibility VARCHAR(50) NULL;
