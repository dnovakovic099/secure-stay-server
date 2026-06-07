-- Migration: Add break logs for time entries
-- Date: 2026-06-07

CREATE TABLE IF NOT EXISTS time_entry_breaks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timeEntryId INT NOT NULL,
    startBreakAt DATETIME NOT NULL,
    endBreakAt DATETIME DEFAULT NULL,
    duration INT DEFAULT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (timeEntryId) REFERENCES time_entries(id) ON DELETE CASCADE
);

CREATE INDEX idx_time_entry_breaks_entry ON time_entry_breaks(timeEntryId);
CREATE INDEX idx_time_entry_breaks_start ON time_entry_breaks(startBreakAt);
CREATE INDEX idx_time_entry_breaks_active ON time_entry_breaks(timeEntryId, endBreakAt);
