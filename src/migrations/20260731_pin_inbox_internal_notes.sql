ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS isPinned TINYINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_pinned
  ON inbox_messages (threadId, isPinned, sentAt);
