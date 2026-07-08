-- Track WHICH user resolved/taught a "Replies to fix" AI analytics miss.
ALTER TABLE ai_message_suggestions
    ADD COLUMN missResolvedBy VARCHAR(255) NULL AFTER missResolvedAt;
