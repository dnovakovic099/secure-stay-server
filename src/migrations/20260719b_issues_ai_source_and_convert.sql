-- Origin metadata on `issues` and Convert-to-Issue link on `ai_detected_items`.
--
-- Powers the Action Items (Testing) → Guest Issue promotion flow. When a user
-- clicks "Open ticket" on an AI proposal, the backend creates an `issues` row
-- tagged with the detector source + confidence, and stamps the resulting
-- issues.id back on the proposal so repeat opens are idempotent and the UI
-- can show a "Ticket #N" badge.
--
-- All columns are additive + nullable. Existing rows are treated as
-- source = 'manual' by the reader; no backfill required.
--
-- Idempotent — safe to re-run.

-- issues.source: 'manual' | 'hostbuddy' | 'ai_inbox' | 'ai_quo' | 'ai_beta'
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `issues` ADD COLUMN `source` VARCHAR(255) NULL',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND COLUMN_NAME = 'source');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `issues` ADD INDEX `IDX_issues_source` (`source`)',
  'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND INDEX_NAME = 'IDX_issues_source');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- issues.aiConfidence: detector confidence (0.000–1.000). NULL for manual tickets.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `issues` ADD COLUMN `aiConfidence` DECIMAL(4,3) NULL',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND COLUMN_NAME = 'aiConfidence');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- issues.aiSourceRef: free-form pointer to the detector artifact
-- (e.g. 'ai_detected_items:1234'). Used to dedupe on repeated Convert clicks.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `issues` ADD COLUMN `aiSourceRef` VARCHAR(255) NULL',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND COLUMN_NAME = 'aiSourceRef');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ai_detected_items.convertedIssueId: link back to the issues row the
-- Action Items (Testing) page created from this proposal.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_detected_items` ADD COLUMN `convertedIssueId` INT NULL',
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_detected_items' AND COLUMN_NAME = 'convertedIssueId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `ai_detected_items` ADD INDEX `IDX_ai_detected_items_convertedIssueId` (`convertedIssueId`)',
  'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_detected_items' AND INDEX_NAME = 'IDX_ai_detected_items_convertedIssueId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
