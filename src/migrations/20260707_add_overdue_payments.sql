-- Persist Hostify payment status on reservations so the Overdue Payments page and
-- the "guest needs to pay" emergency rule can read paid amount without a live API
-- call per row. paidPart mirrors Hostify's paid_part (none/part/full/all).
ALTER TABLE `reservation_info`
  ADD COLUMN `paidAmount` FLOAT NULL,
  ADD COLUMN `paidPart` VARCHAR(20) NULL,
  ADD COLUMN `paymentSyncedAt` TIMESTAMP NULL;

-- Conversation-level emergency flag so the inbox can show a red "guest needs to
-- pay" banner and the response bot can be suppressed for that thread.
ALTER TABLE `inbox_conversations`
  ADD COLUMN `emergency` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `emergencyType` VARCHAR(50) NULL,
  ADD COLUMN `emergencyReason` VARCHAR(500) NULL,
  ADD COLUMN `emergencyAt` DATETIME NULL;

-- Comma/newline separated list of emails that receive payment-emergency alerts.
ALTER TABLE `ai_messaging_settings`
  ADD COLUMN `paymentAlertEmails` TEXT NULL;
