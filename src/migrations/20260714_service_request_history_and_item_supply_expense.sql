CREATE TABLE IF NOT EXISTS service_request_history (
  id INT NOT NULL AUTO_INCREMENT,
  request_type VARCHAR(40) NOT NULL,
  request_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  field_name VARCHAR(120) NULL,
  field_label VARCHAR(160) NULL,
  from_value TEXT NULL,
  to_value TEXT NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_service_request_history_target (request_type, request_id),
  INDEX idx_service_request_history_created_at (created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE item_supply_requests
  ADD COLUMN IF NOT EXISTS expense_id INT NULL;
