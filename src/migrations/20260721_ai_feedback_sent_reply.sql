-- Migration: Persist manager feedback on sent replies
-- Date: 2026-07-21
--
-- Managers need to rate / correct replies AFTER they are sent (rep quality),
-- not only AI drafts. Keep the original sent body so reports can compare
-- what went out vs what the manager preferred.

ALTER TABLE `ai_message_feedback`
    ADD COLUMN IF NOT EXISTS `targetType` VARCHAR(20) NULL
        COMMENT 'suggestion | general | sent_reply',
    ADD COLUMN IF NOT EXISTS `originalMessage` MEDIUMTEXT NULL
        COMMENT 'AI draft or sent reply body at feedback time',
    ADD COLUMN IF NOT EXISTS `subjectUserId` INT NULL
        COMMENT 'user who sent the reply being judged (sent_reply)';
