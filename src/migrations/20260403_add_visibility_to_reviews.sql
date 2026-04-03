-- Add visibility column to reviews table
-- This replaces the binary isHidden flag with a named status string.
-- isHidden is kept for backward compatibility.

ALTER TABLE reviews
  ADD COLUMN visibility VARCHAR(50) NULL AFTER isHidden;

-- Backfill from existing isHidden flag
UPDATE reviews SET visibility = CASE WHEN isHidden = 1 THEN 'Removed' ELSE 'Visible' END;

ALTER TABLE reviews MODIFY COLUMN visibility VARCHAR(50) NOT NULL DEFAULT 'Awaiting Review';
