ALTER TABLE upsell_info
  ADD COLUMN IF NOT EXISTS serviceType VARCHAR(100) NULL AFTER title,
  ADD COLUMN IF NOT EXISTS internalNotes TEXT NULL AFTER description;

CREATE TABLE IF NOT EXISTS upsell_property_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  upSellId INT NOT NULL,
  listingId BIGINT NOT NULL,
  serviceType VARCHAR(100) NULL,
  actualFee DECIMAL(10,2) NULL,
  processingFee DECIMAL(5,2) NULL,
  chargeType VARCHAR(50) NULL,
  upsellFee DECIMAL(10,2) NULL,
  internalNotes TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_upsell_property_config (upSellId, listingId),
  KEY idx_upsell_property_config_upsell (upSellId),
  KEY idx_upsell_property_config_listing (listingId)
);
