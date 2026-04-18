CREATE TABLE IF NOT EXISTS utility_managed_option (
  id INT NOT NULL AUTO_INCREMENT,
  kind VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  created_by VARCHAR(255) NULL,
  updated_by VARCHAR(255) NULL,
  deleted_by VARCHAR(255) NULL,
  PRIMARY KEY (id),
  INDEX idx_utility_managed_option_kind (kind),
  INDEX idx_utility_managed_option_deleted_at (deleted_at)
);
