-- Verifier pass: an independent model fact-checks each drafted reply against
-- its generation context and produces a calibrated send-confidence (0..100).
-- Auto-send gating will trust this over the generator's self-reported score.

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `verifierConfidence` DECIMAL(5,2) NULL AFTER `confidence`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_message_suggestions' AND COLUMN_NAME = 'verifierConfidence'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_message_suggestions` ADD COLUMN `verifierNote` VARCHAR(255) NULL AFTER `verifierConfidence`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_message_suggestions' AND COLUMN_NAME = 'verifierNote'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
