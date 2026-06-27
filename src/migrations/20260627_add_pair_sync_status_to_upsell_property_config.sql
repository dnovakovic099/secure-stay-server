ALTER TABLE upsell_property_config
  ADD COLUMN IF NOT EXISTS pairSyncStatus VARCHAR(20) NULL AFTER upsellFee;
