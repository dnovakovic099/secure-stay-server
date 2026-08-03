-- Track when staff dismissed a skipped-message bubble in the inbox thread.
-- Populated by POST /inbox-v2/auto-messages/logs/:id/dismiss ("Cancel" action
-- on the red AutoMessageSkipBubble). When set, the bubble collapses to a
-- one-line "Automated message cancelled" chip instead of the full body +
-- Send / Edit / Cancel actions.

ALTER TABLE auto_message_log
  ADD COLUMN IF NOT EXISTS `dismissedAt` DATETIME NULL;
