ALTER TABLE upsell_property_config
  ADD COLUMN IF NOT EXISTS pmFee DECIMAL(5,2) NULL AFTER serviceType;
