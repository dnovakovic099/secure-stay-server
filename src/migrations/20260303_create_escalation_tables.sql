-- Migration: Create escalation_settings and ai_escalation_logs tables
-- Date: 2026-03-03

-- Table for escalation settings
CREATE TABLE IF NOT EXISTS escalation_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    slack_channel VARCHAR(100),
    event_type VARCHAR(100),
    overdue_threshold_hours INT NOT NULL DEFAULT 4,
    reminder_interval_hours INT NOT NULL DEFAULT 1,
    daily_reminder_time VARCHAR(10) NOT NULL DEFAULT '10:00',
    primary_employee_id INT,
    fallback_slack_group_id VARCHAR(50) NOT NULL DEFAULT 'S09AUHMA6HE',
    check_shift_schedule BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    ai_enabled BOOLEAN NOT NULL DEFAULT true,
    ai_instructions TEXT,
    ai_mode VARCHAR(20) DEFAULT 'standard',
    updated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Table for AI escalation logs
CREATE TABLE IF NOT EXISTS ai_escalation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    slack_channel VARCHAR(100),
    event_type VARCHAR(100),
    decision VARCHAR(50) NOT NULL,
    ai_mode VARCHAR(20) DEFAULT 'standard',
    message TEXT,
    reason TEXT,
    executed BOOLEAN DEFAULT false,
    hours_since_creation FLOAT,
    hours_since_last_activity FLOAT,
    previous_reminder_count INT DEFAULT 0,
    custom_instructions TEXT,
    context_summary TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_escalation_logs_task_id (task_id),
    INDEX idx_ai_escalation_logs_decision (decision)
);

-- Create index for escalation settings
CREATE INDEX idx_escalation_settings_key ON escalation_settings(setting_key);
