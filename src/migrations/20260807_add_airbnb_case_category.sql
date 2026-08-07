ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS `airbnbCaseCategory` VARCHAR(48) NULL AFTER `airbnbRefundStatus`;

ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS `airbnbRefundedAmount` DECIMAL(12,2) NULL AFTER `airbnbCaseCategory`,
    ADD COLUMN IF NOT EXISTS `airbnbCaseAutoStatusAppliedAt` DATETIME NULL AFTER `airbnbRefundedAmount`;
