-- Admin insights: user attribution + workload grading storage.
--
-- 1) quo_messages.sentByUserId — internal users.id for messages sent from OUR
--    dashboard (senderName alone couldn't be joined to users). Idempotent.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `quo_messages` ADD COLUMN `sentByUserId` INT NULL AFTER `senderName`, ADD INDEX `idx_quo_messages_sent_by` (`sentByUserId`)',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quo_messages' AND COLUMN_NAME = 'sentByUserId'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) quo_calls — synced OpenPhone call log (per-employee call activity for the
--    admin workload page; mirrors the quo-team-dashboard data source).
CREATE TABLE IF NOT EXISTS `quo_calls` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `externalId` VARCHAR(64) NOT NULL,
  `conversationId` VARCHAR(64) NULL,
  `phoneNumberId` VARCHAR(40) NULL,
  `direction` VARCHAR(10) NOT NULL,
  `status` VARCHAR(30) NULL,
  `duration` INT NOT NULL DEFAULT 0,
  `answeredBy` VARCHAR(40) NULL,
  `initiatedBy` VARCHAR(40) NULL,
  `quoUserId` VARCHAR(40) NULL,
  `participants` VARCHAR(255) NULL,
  `occurredAt` DATETIME NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quo_calls_external` (`externalId`),
  KEY `idx_quo_calls_occurred` (`occurredAt`),
  KEY `idx_quo_calls_conversation` (`conversationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) admin_workday_grades — one AI-graded (employee, day) cell: estimated
--    active working minutes + quality grade, same approach as the
--    quo-team-dashboard grader but including SecureStay activity.
CREATE TABLE IF NOT EXISTS `admin_workday_grades` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userKey` VARCHAR(255) NOT NULL,        -- lowercased email (joins Quo + SS identities)
  `displayName` VARCHAR(255) NULL,
  `date` DATE NOT NULL,
  `model` VARCHAR(60) NULL,
  `version` INT NOT NULL DEFAULT 1,
  `complete` TINYINT NOT NULL DEFAULT 0,  -- 0 while the day is still in progress
  `activeMinutes` INT NOT NULL DEFAULT 0,
  `callMinutes` INT NOT NULL DEFAULT 0,
  `messageMinutes` INT NOT NULL DEFAULT 0,
  `ssMinutes` INT NOT NULL DEFAULT 0,     -- SecureStay activity portion (AI feedback + inbox replies)
  `workloadGrade` VARCHAR(20) NULL,
  `qualityGrade` VARCHAR(2) NULL,
  `qualityScore` INT NULL,
  `qualityNotes` TEXT NULL,
  `summary` TEXT NULL,
  `examples` MEDIUMTEXT NULL,             -- JSON array of cited moments
  `callsCount` INT NOT NULL DEFAULT 0,
  `quoMessagesCount` INT NOT NULL DEFAULT 0,
  `ssRepliesCount` INT NOT NULL DEFAULT 0,
  `ssAiEventsCount` INT NOT NULL DEFAULT 0,
  `talkSec` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workday_user_date` (`userKey`, `date`),
  KEY `idx_workday_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
