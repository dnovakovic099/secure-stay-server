-- Extend ai_learned_facts to support the redesigned Learned tab.
--
-- New columns:
--   factType         — 'qa' | 'style_rule' | 'topic_to_avoid'. Only 'qa' rows
--                      surface as guest answers; the other two feed the prompt
--                      as rules and are surfaced in the Settings tab.
--   visibility       — 'internal' | 'external'. Mirrors the Knowledge Base
--                      visibility model. Internal facts are never quoted to
--                      guests; only external QA facts sync to the KB.
--   knowledgeEntryId — Pointer to a listing_knowledge_entries.id when the fact
--                      is synced there. Edits on either side sync through
--                      AILearnedFactsService.
--
-- Defaults preserve current behaviour: existing rows become factType='qa',
-- visibility='external' (guest-shareable Q&A). Idempotent guards below.

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_learned_facts` ADD COLUMN `factType` VARCHAR(24) NOT NULL DEFAULT ''qa'' AFTER `topic`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_learned_facts' AND COLUMN_NAME = 'factType');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_learned_facts` ADD COLUMN `visibility` VARCHAR(16) NOT NULL DEFAULT ''external'' AFTER `factType`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_learned_facts' AND COLUMN_NAME = 'visibility');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_learned_facts` ADD COLUMN `knowledgeEntryId` BIGINT NULL AFTER `visibility`',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_learned_facts' AND COLUMN_NAME = 'knowledgeEntryId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indexes match the @Index decorators on the entity so Learned-tab filters
-- (factType tab, KB-link lookup) stay fast on large fact stores.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_learned_facts` ADD INDEX `IDX_ai_learned_facts_factType` (`factType`)',
  'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_learned_facts' AND INDEX_NAME = 'IDX_ai_learned_facts_factType');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_learned_facts` ADD INDEX `IDX_ai_learned_facts_knowledgeEntryId` (`knowledgeEntryId`)',
  'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_learned_facts' AND INDEX_NAME = 'IDX_ai_learned_facts_knowledgeEntryId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
