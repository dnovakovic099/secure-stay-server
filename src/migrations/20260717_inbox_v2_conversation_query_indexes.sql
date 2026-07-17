-- Indexes for the InboxV2 listConversations query. In production the query
-- can take 10+ seconds because the mirror-dedup NOT EXISTS subquery correlates
-- on guestId / guestName / reservationId with OR conditions, and none of those
-- (except reservationId) were indexed on inbox_conversations. Every candidate
-- row would scan the whole table for possible sibling matches -> O(n²).
--
-- Each ADD INDEX is guarded by an INFORMATION_SCHEMA lookup so this migration
-- is idempotent even on schemas where an operator has already added an index
-- by hand (matching the pattern in 20260714_add_service_pms_to_listing_group_map.sql).

-- 1) inbox_conversations.guestId - powers the guestId branch of the mirror-dedup NOT EXISTS
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `inbox_conversations` ADD INDEX `idx_inbox_conversations_guest_id` (`guestId`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbox_conversations'
    AND INDEX_NAME = 'idx_inbox_conversations_guest_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) inbox_conversations.guestName - covers the guestName+phone/email fallback branch
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `inbox_conversations` ADD INDEX `idx_inbox_conversations_guest_name` (`guestName`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbox_conversations'
    AND INDEX_NAME = 'idx_inbox_conversations_guest_name'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) inbox_conversations composite for outer filter + ORDER BY
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `inbox_conversations` ADD INDEX `idx_inbox_conversations_archived_activity` (`isArchived`, `emergency`, `lastMessageAt`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbox_conversations'
    AND INDEX_NAME = 'idx_inbox_conversations_archived_activity'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) inbox_messages composite for the latest-per-thread EXISTS subqueries
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `inbox_messages` ADD INDEX `idx_inbox_messages_thread_sent_at` (`threadId`, `sentAt`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbox_messages'
    AND INDEX_NAME = 'idx_inbox_messages_thread_sent_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) inbox_messages composite for the repliedBy EXISTS subquery
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `inbox_messages` ADD INDEX `idx_inbox_messages_thread_direction` (`threadId`, `direction`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbox_messages'
    AND INDEX_NAME = 'idx_inbox_messages_thread_direction'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6) listing_group_map.service_pms - used in outer WHERE and inside mirror-dedup subquery
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `listing_group_map` ADD INDEX `idx_lgm_service_pms` (`service_pms`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listing_group_map'
    AND INDEX_NAME = 'idx_lgm_service_pms'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
