CREATE TABLE IF NOT EXISTS reservation_detail_pre_stay_audit_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservationId BIGINT NOT NULL,
  fieldName VARCHAR(100) NOT NULL,
  oldValue TEXT NULL,
  newValue TEXT NULL,
  changedBy VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL DEFAULT 'UPDATE',
  changedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pre_stay_audit_history_reservation_id (reservationId),
  INDEX idx_pre_stay_audit_history_changed_at (changedAt)
);
