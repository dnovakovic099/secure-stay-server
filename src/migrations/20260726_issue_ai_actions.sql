-- IR Copilot: structured log of the actions the bot executed on a ticket, so
-- Issue Resolution Analytics can measure bot activity without LIKE-matching
-- free-text rows in `issues_updates`.

CREATE TABLE IF NOT EXISTS `issue_ai_actions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `issueId` INT NOT NULL,
  `suggestionId` INT NULL,
  `listingId` INT NULL,
  -- SecureStay user who confirmed the action; NULL for opt-in automation.
  `userId` INT NULL,
  -- guest_message | guest_sms | vendor_sms | internal_note | follow_up
  -- | vendor_taught | auto_assign | auto_ack
  `actionType` VARCHAR(32) NOT NULL,
  -- inbox | quo | deep_link | ticket | NULL
  `channel` VARCHAR(32) NULL,
  -- executed | skipped
  `status` VARCHAR(16) NOT NULL DEFAULT 'executed',
  `automated` TINYINT(1) NOT NULL DEFAULT 0,
  `detail` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_issue_ai_actions_issue` (`issueId`),
  KEY `idx_issue_ai_actions_suggestion` (`suggestionId`),
  KEY `idx_issue_ai_actions_type` (`actionType`),
  KEY `idx_issue_ai_actions_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from the system updates IR Copilot has been writing since Phase 2.
-- Internal notes are not backfillable (they were logged as plain ticket notes
-- with no copilot marker), so they start counting from this migration forward.
INSERT INTO `issue_ai_actions`
  (`issueId`, `listingId`, `actionType`, `channel`, `status`, `automated`, `detail`, `createdAt`)
SELECT
  u.issueId,
  CASE WHEN i.listing_id REGEXP '^[0-9]+$' THEN CAST(i.listing_id AS UNSIGNED) ELSE NULL END,
  CASE
    WHEN u.updates LIKE 'IR Copilot: guest message sent via Inbox%' THEN 'guest_message'
    WHEN u.updates LIKE 'IR Copilot: guest SMS sent via Quo%'      THEN 'guest_sms'
    WHEN u.updates LIKE 'IR Copilot taught vendor:%'               THEN 'vendor_taught'
    WHEN u.updates LIKE 'IR Copilot: follow-up scheduled%'         THEN 'follow_up'
    WHEN u.updates LIKE 'IR Copilot auto-assigned%'                THEN 'auto_assign'
    WHEN u.updates LIKE 'IR Copilot auto-ack sent%'                THEN 'auto_ack'
  END,
  CASE
    WHEN u.updates LIKE 'IR Copilot: guest message sent via Inbox%' THEN 'inbox'
    WHEN u.updates LIKE 'IR Copilot: guest SMS sent via Quo%'      THEN 'quo'
    WHEN u.updates LIKE 'IR Copilot auto-ack sent%'                THEN 'inbox'
    ELSE 'ticket'
  END,
  'executed',
  CASE WHEN u.updates LIKE 'IR Copilot auto-%' THEN 1 ELSE 0 END,
  LEFT(u.updates, 1000),
  u.createdAt
FROM `issues_updates` u
JOIN `issues` i ON i.id = u.issueId
WHERE u.deletedAt IS NULL
  AND u.updates LIKE 'IR Copilot%'
  AND (
    u.updates LIKE 'IR Copilot: guest message sent via Inbox%'
    OR u.updates LIKE 'IR Copilot: guest SMS sent via Quo%'
    OR u.updates LIKE 'IR Copilot taught vendor:%'
    OR u.updates LIKE 'IR Copilot: follow-up scheduled%'
    OR u.updates LIKE 'IR Copilot auto-assigned%'
    OR u.updates LIKE 'IR Copilot auto-ack sent%'
  );

-- Analytics groups feedback by reviewer and rating; the table only had
-- suggestion/issue/created indexes.
CREATE INDEX `idx_issue_ai_feedback_user` ON `issue_ai_feedback` (`userId`);
CREATE INDEX `idx_issue_ai_feedback_rating` ON `issue_ai_feedback` (`rating`);
