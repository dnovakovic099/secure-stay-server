-- Inbox V2 Proposed Actions settings.
-- These are human-approved operation cards, separate from normal AI reply
-- drafting. Existing rows fall back to the compiled defaults when text is NULL.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `proposedActionsEnabled` TINYINT NOT NULL DEFAULT 1 AFTER `detectionFeedback`,
    ADD COLUMN IF NOT EXISTS `proposedActionInstructions` TEXT NULL AFTER `proposedActionsEnabled`,
    ADD COLUMN IF NOT EXISTS `proposedActionApproveInstructions` TEXT NULL AFTER `proposedActionInstructions`,
    ADD COLUMN IF NOT EXISTS `proposedActionApproveSendInstructions` TEXT NULL AFTER `proposedActionApproveInstructions`;
