-- Hostify support (Jul 2026): the app's "Paid %" is paid_sum / payout_price * 100.
-- payout_price is the expected total returned in the reservation payload (not in
-- their docs' attribute table). Persist it so overdue math matches Hostify exactly.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `reservation_info` ADD COLUMN `payoutPrice` FLOAT NULL AFTER `paidPart`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservation_info' AND COLUMN_NAME = 'payoutPrice'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
