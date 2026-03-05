-- Migration: Add missing columns to ai_escalation_logs table
-- Date: 2026-03-05
-- Fix: "Unknown column 'AIEscalationLog.slack_message_ts' in 'field list'" error

ALTER TABLE ai_escalation_logs
    ADD COLUMN slack_message_ts VARCHAR(255) NULL AFTER error,
    ADD COLUMN slack_channel_id VARCHAR(255) NULL AFTER slack_message_ts,
    ADD COLUMN slack_permalink VARCHAR(255) NULL AFTER slack_channel_id,
    ADD COLUMN feedback TEXT NULL AFTER slack_permalink,
    ADD COLUMN feedback_rating VARCHAR(255) NULL AFTER feedback,
    ADD COLUMN feedback_by INT NULL AFTER feedback_rating,
    ADD COLUMN feedback_at TIMESTAMP NULL AFTER feedback_by;
