ALTER TABLE upsell_property_config
  ADD COLUMN IF NOT EXISTS description TEXT NULL AFTER internalNotes,
  ADD COLUMN IF NOT EXISTS image VARCHAR(200) NULL AFTER description;
