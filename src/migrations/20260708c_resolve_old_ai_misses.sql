-- Clear the "Replies to fix" queue of AI misses generated before July 6, 2026.
-- The bot's grounding (live availability, learned facts, proven replies,
-- feedback loop) changed substantially since then, so older misses no longer
-- reflect current behavior and just bury the actionable ones. Rows are marked
-- resolved (not deleted) so they remain visible with "include resolved".
UPDATE `ai_message_suggestions`
SET `missResolvedAt` = NOW()
WHERE `aiReplyQuality` = 'missed'
  AND `missResolvedAt` IS NULL
  AND `generatedAt` < '2026-07-06 00:00:00';
