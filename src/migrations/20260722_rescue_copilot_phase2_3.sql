-- Rescue Copilot phases 2–3: fail/notify tracking, shift pings, settings.

ALTER TABLE ai_messaging_settings
  ADD COLUMN IF NOT EXISTS `rescueNotifyAnjEnabled` TINYINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS `rescueGestures` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `rescueUnansweredMinutes` INT NOT NULL DEFAULT 30;

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS `rescueFailedAt` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `rescueNotifiedAt` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `rescueLastPingAt` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `rescueMoodAtActivate` TINYINT NULL;
