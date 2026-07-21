-- Persist the Hostify per-reservation `fees` breakdown so accounting dashboards
-- (Claims Fee Funds, income reports) can read it without a live API call.
-- Requires fetches to include fees=1 & fees_costs=1. `resortFee` matches the
-- first candidate in ExpenseService.getReservationClaimsFeeColumn().

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `reservation_info` ADD COLUMN `accommodationFee` FLOAT NULL',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'accommodationFee'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `reservation_info` ADD COLUMN `resortFee` FLOAT NULL',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'resortFee'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `reservation_info` ADD COLUMN `cleaningFeeAmount` FLOAT NULL',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'cleaningFeeAmount'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `reservation_info` ADD COLUMN `managementCommission` FLOAT NULL',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'managementCommission'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `reservation_info` ADD COLUMN `insuranceFee` FLOAT NULL',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'insuranceFee'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
