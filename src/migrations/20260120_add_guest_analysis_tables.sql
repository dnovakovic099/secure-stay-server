-- Create guest_communication table for storing raw communication data
-- from OpenPhone (calls, SMS) and Hostify (messages)

CREATE TABLE IF NOT EXISTS guest_communication (
    id VARCHAR(36) PRIMARY KEY,
    reservationId INT NOT NULL,
    source VARCHAR(50) NOT NULL COMMENT 'openphone_call | openphone_sms | hostify_message',
    externalId VARCHAR(255) NULL COMMENT 'ID from source system',
    content TEXT NOT NULL COMMENT 'Message body, call transcript, or call summary',
    direction VARCHAR(20) NOT NULL COMMENT 'inbound | outbound',
    senderName VARCHAR(100) NULL,
    senderPhone VARCHAR(50) NULL,
    communicatedAt DATETIME NOT NULL,
    metadata JSON NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_guest_communication_reservation (reservationId),
    INDEX idx_guest_communication_source (source),
    INDEX idx_guest_communication_communicated_at (communicatedAt)
);

-- Create guest_analysis table for storing AI-generated analysis results
CREATE TABLE IF NOT EXISTS guest_analysis (
    id VARCHAR(36) PRIMARY KEY,
    reservationId INT NOT NULL,
    summary TEXT NOT NULL COMMENT 'AI-generated interaction summary',
    sentiment VARCHAR(20) NOT NULL COMMENT 'Positive | Neutral | Negative | Mixed',
    sentimentReason TEXT NOT NULL COMMENT '1-2 line explanation of sentiment',
    flags JSON NOT NULL COMMENT 'Array of operational flags with explanations',
    analyzedAt DATETIME NOT NULL,
    analyzedBy VARCHAR(50) NULL COMMENT 'auto | manual | user ID',
    communicationIds JSON NULL COMMENT 'IDs of communications analyzed',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_guest_analysis_reservation (reservationId),
    INDEX idx_guest_analysis_sentiment (sentiment),
    INDEX idx_guest_analysis_analyzed_at (analyzedAt),
    UNIQUE KEY unique_reservation_analysis (reservationId)
);
