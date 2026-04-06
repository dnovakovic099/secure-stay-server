-- Migration: Add AI tracking fields to zapier_trigger_events
-- Date: 2026-04-06
-- Fix: Unknown column 'event.next_follow_up_at' in 'field list'

ALTER TABLE zapier_trigger_events
    ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS ignored_prompt_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vague_reply_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS completion_quality_score FLOAT NULL,
    ADD COLUMN IF NOT EXISTS last_ai_review_summary TEXT NULL,
    ADD COLUMN IF NOT EXISTS last_ai_review_payload MEDIUMTEXT NULL,
    ADD COLUMN IF NOT EXISTS last_ai_review_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS assigned_rep_name VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS assigned_rep_slack_id VARCHAR(100) NULL;
