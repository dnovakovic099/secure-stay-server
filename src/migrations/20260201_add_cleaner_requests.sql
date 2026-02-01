-- Create cleaner_requests table for storing cleaner request form submissions

CREATE TABLE IF NOT EXISTS cleaner_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    property_id INT NOT NULL,
    fullAddress TEXT NULL,
    specialArrangementPreference TEXT NULL,
    isPropertyReadyCleaned TEXT NULL,
    scheduleInitialClean TEXT NULL,
    propertyAccessInformation TEXT NULL,
    cleaningClosetCodeLocation TEXT NULL,
    trashScheduleInstructions TEXT NULL,
    suppliesToRestock TEXT NULL,
    status VARCHAR(50) DEFAULT 'pending' COMMENT 'pending, scheduled, completed, cancelled',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    createdBy VARCHAR(255) NULL,
    updatedBy VARCHAR(255) NULL,
    INDEX idx_cleaner_requests_property (property_id),
    INDEX idx_cleaner_requests_status (status),
    CONSTRAINT fk_cleaner_requests_property 
        FOREIGN KEY (property_id) REFERENCES client_properties(id) ON DELETE CASCADE
);
