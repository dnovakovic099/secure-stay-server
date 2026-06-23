ALTER TABLE upsell_info
  ADD COLUMN IF NOT EXISTS isDefault TINYINT(1) NOT NULL DEFAULT 0 AFTER isActive;

CREATE INDEX IF NOT EXISTS idx_upsell_info_is_default ON upsell_info (isDefault);
