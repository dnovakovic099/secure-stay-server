CREATE TABLE IF NOT EXISTS listing_change_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  listingId BIGINT NOT NULL,
  hostifyListingId BIGINT NULL,
  changedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  changedBy VARCHAR(255) NOT NULL DEFAULT 'Hostify Sync',
  diff JSON NOT NULL,
  source VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_listing_change_log_listing_id (listingId),
  INDEX idx_listing_change_log_changed_at (changedAt)
);
