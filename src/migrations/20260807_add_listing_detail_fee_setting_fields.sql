ALTER TABLE listing_details
  ADD COLUMN claims_fee_status VARCHAR(255) NULL AFTER claimProtection,
  ADD COLUMN plus_50_cleaning_fee TINYINT(1) NULL DEFAULT 0 AFTER tech_fee_amount;
