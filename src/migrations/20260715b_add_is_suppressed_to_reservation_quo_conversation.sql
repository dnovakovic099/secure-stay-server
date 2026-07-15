-- Allow explicit "hide this Quo thread from this reservation" — necessary
-- because the v2 inbox pulls Quo conversations via three paths:
--   1. auto-link (quo_conversations.reservationId set at sync time),
--   2. manual attach (isSuppressed = 0 row in this table),
--   3. phone-match fallback (last-10-digit match on the guest phone).
-- Path 3 keeps re-adding a conversation the rep closed on the tab bar; a
-- suppression row here overrides all three and keeps the tab closed.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `reservation_quo_conversation` ADD COLUMN `isSuppressed` TINYINT NOT NULL DEFAULT 0 AFTER `quoConversationId`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reservation_quo_conversation'
    AND COLUMN_NAME = 'isSuppressed'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
