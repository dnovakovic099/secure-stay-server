ALTER TABLE upsell_property_config
  ADD COLUMN IF NOT EXISTS rateConfiguration VARCHAR(50) NULL AFTER chargeType,
  ADD COLUMN IF NOT EXISTS pricingRules TEXT NULL AFTER rateConfiguration;
