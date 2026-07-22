-- IR Copilot: persisted playbook suggestions + structured feedback (mirrors inbox AI).

CREATE TABLE IF NOT EXISTS `issue_ai_suggestions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `issueId` INT NOT NULL,
  `listingId` INT NULL,
  `reservationId` INT NULL,
  `summary` TEXT NULL,
  `severity` VARCHAR(32) NULL,
  `primaryAction` TEXT NULL,
  `playbookJson` MEDIUMTEXT NULL,
  `recommendedContactsJson` MEDIUMTEXT NULL,
  `draftGuestMessage` MEDIUMTEXT NULL,
  `draftInternalNote` MEDIUMTEXT NULL,
  `draftVendorMessage` MEDIUMTEXT NULL,
  `warningsJson` TEXT NULL,
  `confidence` DECIMAL(5,2) NULL,
  `modelName` VARCHAR(64) NULL,
  `promptVersion` VARCHAR(32) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'suggested',
  `rawResponse` MEDIUMTEXT NULL,
  `generatedAt` DATETIME NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_issue_ai_suggestions_issue` (`issueId`),
  KEY `idx_issue_ai_suggestions_status` (`status`),
  KEY `idx_issue_ai_suggestions_generated` (`generatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `issue_ai_feedback` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `suggestionId` INT NULL,
  `issueId` INT NULL,
  `listingId` INT NULL,
  `userId` INT NULL,
  `rating` VARCHAR(10) NULL,
  `categories` TEXT NULL,
  `feedbackText` TEXT NULL,
  `correctedResponse` MEDIUMTEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_issue_ai_feedback_suggestion` (`suggestionId`),
  KEY `idx_issue_ai_feedback_issue` (`issueId`),
  KEY `idx_issue_ai_feedback_created` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
