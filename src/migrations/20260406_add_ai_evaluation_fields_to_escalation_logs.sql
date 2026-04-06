-- Migration: Add AI evaluation fields to ai_escalation_logs
-- Date: 2026-04-06
-- Fix: Unknown column 'log.severity_level' in 'field list'

ALTER TABLE ai_escalation_logs
    ADD COLUMN IF NOT EXISTS severity_level VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS rep_engagement_type VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS neglect_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS urgency_score FLOAT NULL,
    ADD COLUMN IF NOT EXISTS completion_quality FLOAT NULL,
    ADD COLUMN IF NOT EXISTS recommended_action VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS escalation_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reasoning_summary TEXT NULL,
    ADD COLUMN IF NOT EXISTS decision_input_summary TEXT NULL,
    ADD COLUMN IF NOT EXISTS decision_payload MEDIUMTEXT NULL,
    ADD COLUMN IF NOT EXISTS feedback_type VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS feedback_scope VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS expected_behavior TEXT NULL,
    ADD COLUMN IF NOT EXISTS manager_comment TEXT NULL;
