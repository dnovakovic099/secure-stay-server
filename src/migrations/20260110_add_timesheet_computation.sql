-- Migration: Add timesheet computation columns and overtime_requests table
-- Date: 2026-01-10

-- Add computed duration columns to time_entries
ALTER TABLE time_entries ADD COLUMN computedDuration INT NULL;
ALTER TABLE time_entries ADD COLUMN isMissedClockout BOOLEAN DEFAULT FALSE;
ALTER TABLE time_entries ADD COLUMN hasOvertimeRequest BOOLEAN DEFAULT FALSE;

-- Create overtime_requests table
CREATE TABLE overtime_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timeEntryId INT NOT NULL,
    userId INT NOT NULL,
    actualDurationSeconds INT NOT NULL,
    cappedDurationSeconds INT NOT NULL,
    overtimeSeconds INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    approvedBy INT NULL,
    approvedAt DATETIME NULL,
    notes VARCHAR(500) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (timeEntryId) REFERENCES time_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL
);

-- Add indexes for common queries
CREATE INDEX idx_overtime_status ON overtime_requests(status);
CREATE INDEX idx_overtime_user ON overtime_requests(userId);
CREATE INDEX idx_overtime_time_entry ON overtime_requests(timeEntryId);
