-- Inbox pin for threads where AI deferred to humans or guest is frustrated with AI.
-- Surfaces in the "AI Needs Team" section (separate from Urgent safety/access pins).

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS `aiNeedsHuman` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `aiNeedsHumanKind` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `aiNeedsHumanReason` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `aiNeedsHumanAt` DATETIME NULL;

CREATE INDEX IF NOT EXISTS `idx_inbox_conversations_ai_needs_human`
  ON inbox_conversations (`aiNeedsHuman`, `aiNeedsHumanAt`);
