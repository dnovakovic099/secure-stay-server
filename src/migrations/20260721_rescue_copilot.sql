-- Rescue Copilot: settings toggle (default ON) + per-conversation rescue state.

ALTER TABLE ai_messaging_settings
  ADD COLUMN IF NOT EXISTS `rescueCopilotEnabled` TINYINT NOT NULL DEFAULT 1;

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS `rescueStatus` VARCHAR(24) NULL,
  ADD COLUMN IF NOT EXISTS `rescueCause` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `rescueWhy` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `rescueGesture` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `rescueActivatedAt` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `rescueDismissedUntil` DATETIME NULL;
