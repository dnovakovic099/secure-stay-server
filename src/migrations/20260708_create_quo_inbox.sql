-- Quo (OpenPhone) SMS inbox — completely separate from the Hostify Inbox V2.
-- Stores our PM/GR phone lines, their conversations and messages, plus the
-- reservation link resolved from the participant's phone number.

CREATE TABLE IF NOT EXISTS `quo_phone_lines` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `phoneNumberId` VARCHAR(40) NOT NULL,
  `number` VARCHAR(20) NOT NULL,
  `name` VARCHAR(255) NULL,
  `symbol` VARCHAR(10) NULL,
  -- PM | GR | maintenance | sales | other. Only PM + GR lines sync.
  `category` VARCHAR(20) NOT NULL DEFAULT 'other',
  `enabled` TINYINT NOT NULL DEFAULT 0,
  `lastSyncedAt` DATETIME NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `UQ_quo_phone_lines_phoneNumberId` (`phoneNumberId`)
);

CREATE TABLE IF NOT EXISTS `quo_conversations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `conversationId` VARCHAR(64) NOT NULL,
  `phoneNumberId` VARCHAR(40) NOT NULL,
  `lineNumber` VARCHAR(20) NULL,
  `lineName` VARCHAR(255) NULL,
  `participantPhone` VARCHAR(30) NULL,
  `participants` VARCHAR(500) NULL,
  `contactName` VARCHAR(255) NULL,
  `reservationId` BIGINT NULL,
  `listingId` BIGINT NULL,
  `listingName` VARCHAR(255) NULL,
  `guestName` VARCHAR(255) NULL,
  -- phone | message | manual — how the reservation link was resolved
  `linkMethod` VARCHAR(20) NULL,
  `lastMessageText` TEXT NULL,
  `lastMessageAt` DATETIME NULL,
  `lastDirection` VARCHAR(10) NULL,
  `unread` TINYINT NOT NULL DEFAULT 0,
  `isArchived` TINYINT NOT NULL DEFAULT 0,
  `lastDetectAt` DATETIME NULL,
  `syncedAt` DATETIME NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `UQ_quo_conversations_conversationId` (`conversationId`),
  INDEX `IDX_quo_conversations_phoneNumberId` (`phoneNumberId`),
  INDEX `IDX_quo_conversations_lastMessageAt` (`lastMessageAt`),
  INDEX `IDX_quo_conversations_participantPhone` (`participantPhone`)
);

CREATE TABLE IF NOT EXISTS `quo_messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `externalId` VARCHAR(64) NOT NULL,
  `conversationId` VARCHAR(64) NOT NULL,
  `phoneNumberId` VARCHAR(40) NULL,
  `body` MEDIUMTEXT NULL,
  `direction` VARCHAR(10) NOT NULL,
  `fromNumber` VARCHAR(30) NULL,
  `toNumbers` VARCHAR(255) NULL,
  `mediaUrls` TEXT NULL,
  `status` VARCHAR(20) NULL,
  `quoUserId` VARCHAR(40) NULL,
  `senderName` VARCHAR(255) NULL,
  `sentAt` DATETIME NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `UQ_quo_messages_externalId` (`externalId`),
  INDEX `IDX_quo_messages_conversationId` (`conversationId`),
  INDEX `IDX_quo_messages_sentAt` (`sentAt`)
);

-- Action items created from Quo conversations are tagged so they can be
-- filtered separately from the Hostify/manual ones.
ALTER TABLE `action_items`
  ADD COLUMN `source` VARCHAR(20) NULL,
  ADD COLUMN `quoConversationId` VARCHAR(64) NULL;
