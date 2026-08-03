ALTER TABLE vendor_assignments
    ADD COLUMN IF NOT EXISTS strikes INT NULL AFTER costRating;
