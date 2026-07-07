-- Discarded action items + the team's reason. Fed into the AI item-detection
-- prompt as negative examples so it learns which items are not needed.
CREATE TABLE IF NOT EXISTS `ai_discard_feedback` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` VARCHAR(20) NOT NULL DEFAULT 'action_item',
  `actionItemId` INT NULL,
  `itemText` TEXT NULL,
  `category` VARCHAR(120) NULL,
  `listingId` INT NULL,
  `listingName` VARCHAR(255) NULL,
  `guestName` VARCHAR(255) NULL,
  `reservationId` BIGINT NULL,
  `reason` TEXT NOT NULL,
  `discardedBy` VARCHAR(255) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `IDX_ai_discard_feedback_type` (`type`),
  INDEX `IDX_ai_discard_feedback_createdAt` (`createdAt`)
);
