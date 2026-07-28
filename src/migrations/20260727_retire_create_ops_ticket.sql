-- Retire "create_ops_ticket" proposed actions.
--
-- Two systems reacted to the same inbound guest message with no knowledge of
-- each other: InboxItemDetectionService auto-opened a Guest Issues ticket, while
-- AIProposedActionService independently raised a "create a maintenance/ops task?"
-- card off a keyword regex. The card carried no proposedReply, so approving it
-- only wrote a second work item for something already ticketed. GR reported
-- seeing both for every problem report.
--
-- The proposal is no longer generated or executable in code. This closes out the
-- rows created before that cutover so they stop appearing as actionable cards.
-- Rows are kept rather than deleted so the audit trail survives; only still-open
-- ones move to dismissed. executedAt is stamped to match dismiss() in the
-- service, which records when a proposal left the queue.
--
-- No semicolons inside string literals here: migrationRunner splits statements
-- on ";" without respecting quotes, so one would break this into invalid halves.

UPDATE `ai_proposed_actions`
SET `status` = 'dismissed',
    `executedAt` = COALESCE(`executedAt`, NOW()),
    `resultNote` = 'auto-dismissed: create_ops_ticket retired, Guest Issues ticket covers this'
WHERE `actionType` = 'create_ops_ticket'
  AND `status` = 'proposed'
