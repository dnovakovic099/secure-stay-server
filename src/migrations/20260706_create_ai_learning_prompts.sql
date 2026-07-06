CREATE TABLE IF NOT EXISTS `ai_learning_prompts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `threadId` BIGINT NOT NULL,
  `listingId` BIGINT NULL,
  `listingName` VARCHAR(255) NULL,
  `question` TEXT NOT NULL,
  `topic` VARCHAR(120) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `answerText` TEXT NULL,
  `answerScope` VARCHAR(20) NULL,
  `answeredByUserId` INT NULL,
  `resolvedAt` DATETIME NULL,
  `resolvedVia` VARCHAR(20) NULL,
  `sampleSuggestionId` BIGINT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `IDX_ai_learning_prompts_thread` (`threadId`),
  INDEX `IDX_ai_learning_prompts_status` (`status`)
);
