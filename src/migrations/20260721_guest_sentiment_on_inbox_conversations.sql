-- Guest sentiment (1–10) from AI suggestion generation, shown in Inbox V2.

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS `guestSentimentScore` TINYINT NULL,
  ADD COLUMN IF NOT EXISTS `guestSentimentLabel` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `guestSentimentNote` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `guestSentimentAt` DATETIME NULL;
