-- Create photographer_requests table for storing photographer request form submissions

CREATE TABLE IF NOT EXISTS photographer_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    property_id INT NOT NULL,
    ownerNamePropertyInternalName TEXT NULL,
    serviceType VARCHAR(100) NULL COMMENT 'Launch, Pro, Full Service, Others (Add to Sales Note)',
    completeAddress TEXT NULL,
    numberOfBedrooms INT NULL,
    numberOfBathrooms INT NULL,
    sqftOfHouse INT NULL,
    availability TEXT NULL,
    onboardingRep VARCHAR(255) NULL,
    status VARCHAR(50) DEFAULT 'pending' COMMENT 'pending, scheduled, completed, cancelled',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    createdBy VARCHAR(255) NULL,
    updatedBy VARCHAR(255) NULL,
    INDEX idx_photographer_requests_property (property_id),
    INDEX idx_photographer_requests_status (status),
    CONSTRAINT fk_photographer_requests_property 
        FOREIGN KEY (property_id) REFERENCES client_properties(id) ON DELETE CASCADE
);
