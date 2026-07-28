-- Typed memory for ai_learned_facts.
--
-- The table could previously only express one kind of thing (a stable Q&A fact)
-- about one kind of subject (a property), with no notion of time. That blocked
-- three of the four memory types the assistant needs, and meant a fact learned
-- in January was asserted in July with identical confidence.
--
-- memoryType         permanent_fact | temporary_state | learned_pattern | decision
-- subjectType/Id     what the memory is ABOUT: property | owner | guest | employee | vendor
-- validUntil         explicit expiry; overrides the per-type default TTL
-- supersededByFactId set when a newer memory replaces this one; never used again
-- decisionRationale  WHY a refund/override/exception was granted, for precedent
--
-- Existing rows default to permanent_fact / property, which is what they are.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `memoryType` VARCHAR(24) NOT NULL DEFAULT ''permanent_fact'' AFTER `factType`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'memoryType'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `subjectType` VARCHAR(24) NOT NULL DEFAULT ''property'' AFTER `memoryType`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'subjectType'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- VARCHAR rather than BIGINT: owners and employees are keyed by uid strings in
-- places, and vendors by normalized name.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `subjectId` VARCHAR(128) NULL AFTER `subjectType`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'subjectId'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `validUntil` DATETIME NULL AFTER `lastSeenAt`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'validUntil'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `supersededByFactId` INT NULL AFTER `validUntil`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'supersededByFactId'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_learned_facts` ADD COLUMN `decisionRationale` TEXT NULL AFTER `answer`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND COLUMN_NAME = 'decisionRationale'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Retrieval always filters on (status, memoryType) and, for non-property memory,
-- on (subjectType, subjectId).
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `IDX_alf_memory_type` ON `ai_learned_facts` (`memoryType`, `status`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND INDEX_NAME = 'IDX_alf_memory_type'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX `IDX_alf_subject` ON `ai_learned_facts` (`subjectType`, `subjectId`, `status`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_learned_facts'
    AND INDEX_NAME = 'IDX_alf_subject'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
