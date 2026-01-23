-- Migration: Create zapier_trigger_events table
-- Description: Stores incoming Zapier webhook trigger events for auditing and tracking

CREATE TABLE IF NOT EXISTS zapier_trigger_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'New',
    event VARCHAR(100) NOT NULL,
    bot_name VARCHAR(255) NOT NULL,
    bot_icon TEXT,
    title VARCHAR(255),
    message TEXT NOT NULL,
    slack_channel VARCHAR(100),
    email_subject VARCHAR(500),
    email_body_plain MEDIUMTEXT,
    email_body_html MEDIUMTEXT,
    processed_message MEDIUMTEXT,
    raw_payload MEDIUMTEXT NOT NULL,
    completed_on DATETIME,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    INDEX idx_zapier_event (event),
    INDEX idx_zapier_status (status),
    INDEX idx_zapier_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
