-- Per-message escalation (AI-assisted) + directed notifications for assignees.

CREATE TABLE IF NOT EXISTS `inbox_message_escalations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `threadId` BIGINT NOT NULL,
  `messageExternalId` BIGINT NULL,
  `messageId` INT NULL,
  `actorUid` VARCHAR(64) NOT NULL,
  `actorName` VARCHAR(160) NULL,
  `assigneeUid` VARCHAR(64) NOT NULL,
  `assigneeName` VARCHAR(160) NULL,
  `category` VARCHAR(40) NULL,
  `note` TEXT NOT NULL,
  `aiStepsJson` MEDIUMTEXT NULL,
  `aiSummary` TEXT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'suggested',
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_ime_thread` (`threadId`),
  KEY `IDX_ime_assignee` (`assigneeUid`),
  KEY `IDX_ime_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `user_directed_notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userUid` VARCHAR(64) NOT NULL,
  `actorUid` VARCHAR(64) NULL,
  `actorName` VARCHAR(160) NULL,
  `type` VARCHAR(40) NOT NULL DEFAULT 'escalation',
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NULL,
  `href` VARCHAR(500) NOT NULL,
  `threadId` BIGINT NULL,
  `messageExternalId` BIGINT NULL,
  `escalationId` INT NULL,
  `readAt` DATETIME NULL,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_udn_user_created` (`userUid`, `createdAt`),
  KEY `IDX_udn_user_unread` (`userUid`, `readAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
