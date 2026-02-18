-- Migration: Add thread messages table and escalation fields
-- Date: 2026-02-18

-- Thread messages table for storing Slack thread replies
CREATE TABLE IF NOT EXISTS slack_thread_messages (
    id SERIAL PRIMARY KEY,
    trigger_event_id INTEGER NOT NULL REFERENCES zapier_trigger_events(id) ON DELETE CASCADE,
    message_ts VARCHAR(50) NOT NULL,
    thread_ts VARCHAR(50) NOT NULL,
    user_id VARCHAR(50),
    user_name VARCHAR(255),
    text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(trigger_event_id, message_ts)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_slack_thread_messages_trigger_event_id 
ON slack_thread_messages(trigger_event_id);

CREATE INDEX IF NOT EXISTS idx_slack_thread_messages_thread_ts 
ON slack_thread_messages(thread_ts);

-- Add Slack permalink columns to zapier_trigger_events
ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS slack_permalink VARCHAR(500);

ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS slack_thread_ts VARCHAR(50);

-- Escalation columns for overdue/reminders feature
ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0;

ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMP;

ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0;

ALTER TABLE zapier_trigger_events 
ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN DEFAULT FALSE;

-- Index for escalation queries
CREATE INDEX IF NOT EXISTS idx_zapier_trigger_events_escalation 
ON zapier_trigger_events(status, escalation_level, is_overdue) 
WHERE status IN ('open', 'in_progress');
