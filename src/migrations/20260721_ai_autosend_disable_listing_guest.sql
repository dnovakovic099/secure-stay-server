-- Per-listing and per-guest auto-respond disables.
-- Listing: SS listing page toggle.
-- Guest: inbox toggle for problematic guests (persists by Hostify guestId).

ALTER TABLE listing_details
  ADD COLUMN IF NOT EXISTS `aiAutoRespondDisabled` TINYINT NOT NULL DEFAULT 0;

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS `aiAutoRespondDisabled` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `aiAutoRespondDisabledAt` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `aiAutoRespondDisabledBy` VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS `ai_guest_autosend_disable` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `guestId` BIGINT NOT NULL,
  `guestName` VARCHAR(255) NULL,
  `disabledBy` VARCHAR(255) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_guest_autosend_disable_guest` (`guestId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
