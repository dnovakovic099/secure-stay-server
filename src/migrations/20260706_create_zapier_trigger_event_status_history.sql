-- Migration: Create GR task status history table
-- Date: 2026-07-06

CREATE TABLE IF NOT EXISTS zapier_trigger_event_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,
    previous_status VARCHAR(50) NULL,
    status VARCHAR(50) NOT NULL,
    changed_by VARCHAR(255) NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ztesh_event_changed (event_id, changed_at),
    INDEX idx_ztesh_status_changed (status, changed_at),
    CONSTRAINT fk_ztesh_event
        FOREIGN KEY (event_id)
        REFERENCES zapier_trigger_events(id)
        ON DELETE CASCADE
);
