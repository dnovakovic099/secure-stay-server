ALTER TABLE inbox_conversations
    ADD COLUMN IF NOT EXISTS `airbnbCaseStatus` VARCHAR(24) NULL,
    ADD COLUMN IF NOT EXISTS `airbnbRefundStatus` VARCHAR(32) NULL;
