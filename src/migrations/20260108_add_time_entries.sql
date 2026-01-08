-- Migration: Add time_entries table for clock-in/clock-out feature
-- Created: 2026-01-08

CREATE TABLE IF NOT EXISTS time_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    clockInAt DATETIME NOT NULL,
    clockOutAt DATETIME DEFAULT NULL,
    duration INT DEFAULT NULL,
    notes VARCHAR(500) DEFAULT NULL,
    status ENUM('active', 'completed') DEFAULT 'active',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_time_entries_user ON time_entries(userId);
CREATE INDEX idx_time_entries_status ON time_entries(status);
CREATE INDEX idx_time_entries_clock_in ON time_entries(clockInAt);
