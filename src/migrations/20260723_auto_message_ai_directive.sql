-- Scheduled / auto messages: send-time AI directive + skip-if-inappropriate.
ALTER TABLE auto_message_rules
  ADD COLUMN aiDirective TEXT NULL AFTER messageTemplate,
  ADD COLUMN aiSkipIfInappropriate TINYINT NOT NULL DEFAULT 0 AFTER aiDirective;
