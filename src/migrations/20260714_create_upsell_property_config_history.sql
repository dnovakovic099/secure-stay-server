CREATE TABLE IF NOT EXISTS upsell_property_config_history (
  id INT NOT NULL AUTO_INCREMENT,
  upSellId INT NOT NULL,
  listingId BIGINT NOT NULL,
  fieldName VARCHAR(100) NULL,
  oldValue TEXT NULL,
  newValue TEXT NULL,
  action VARCHAR(50) NOT NULL DEFAULT 'UPDATE',
  changedBy VARCHAR(255) NOT NULL,
  changedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_upsell_property_config_history_upsell_listing (upSellId, listingId),
  INDEX idx_upsell_property_config_history_changed_at (changedAt)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
