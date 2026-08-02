-- AI Needs Team pins were only cleared on Inbox v2 sendReply. Replies that
-- arrived via Hostify/Airbnb webhooks marked the thread answered but left
-- aiNeedsHuman=1, so the violet "AI handoff" badge stuck after humans replied.
-- Heal anything already in that state; ongoing clears happen in InboxService.
UPDATE inbox_conversations
SET aiNeedsHuman = 0,
    aiNeedsHumanKind = NULL,
    aiNeedsHumanReason = NULL,
    aiNeedsHumanAt = NULL
WHERE aiNeedsHuman = 1
  AND answered = 1;
