CREATE TABLE IF NOT EXISTS upsell_order_history (
  id INT NOT NULL AUTO_INCREMENT,
  orderId INT NOT NULL,
  fieldName VARCHAR(100) NOT NULL,
  oldValue TEXT NULL,
  newValue TEXT NULL,
  changedBy VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL DEFAULT 'UPDATE',
  changedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_upsell_order_history_order_id (orderId),
  INDEX idx_upsell_order_history_changed_at (changedAt)
);
