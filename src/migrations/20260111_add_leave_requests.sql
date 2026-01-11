-- Leave Requests Table
-- Migration: 20260111_add_leave_requests.sql

CREATE TABLE IF NOT EXISTS leave_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    leaveType VARCHAR(200) NOT NULL,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    totalDays INT NOT NULL,
    reason VARCHAR(1000) NULL,
    status VARCHAR(50) DEFAULT 'pending',
    paymentType VARCHAR(20) NULL,
    actionedBy INT NULL,
    actionedAt DATETIME NULL,
    adminNotes VARCHAR(500) NULL,
    -- Cancellation tracking
    cancellationRequestedAt DATETIME NULL,
    cancellationActionedBy INT NULL,
    cancellationActionedAt DATETIME NULL,
    cancellationNotes VARCHAR(500) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deletedAt DATETIME NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actionedBy) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (cancellationActionedBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_leave_user (userId),
    INDEX idx_leave_status (status),
    INDEX idx_leave_dates (startDate, endDate)
);
