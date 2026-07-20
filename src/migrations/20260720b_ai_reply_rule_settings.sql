-- Make guest-reply prompt/rule blocks editable from the AI Settings page.
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `baseReplyStyleRules` MEDIUMTEXT NULL AFTER `airbnbSupportRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'baseReplyStyleRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `airbnbSupportBaseRules` MEDIUMTEXT NULL AFTER `baseReplyStyleRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'airbnbSupportBaseRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `inquirySalesBaseRules` MEDIUMTEXT NULL AFTER `airbnbSupportBaseRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'inquirySalesBaseRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `selfServiceTroubleshootingRules` MEDIUMTEXT NULL AFTER `inquirySalesBaseRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'selfServiceTroubleshootingRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `quoSmsRules` MEDIUMTEXT NULL AFTER `selfServiceTroubleshootingRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'quoSmsRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `quoPmClientRules` MEDIUMTEXT NULL AFTER `quoSmsRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'quoPmClientRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `ai_messaging_settings` ADD COLUMN `quoUnlinkedThreadRules` MEDIUMTEXT NULL AFTER `quoPmClientRules`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_messaging_settings' AND COLUMN_NAME = 'quoUnlinkedThreadRules'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
