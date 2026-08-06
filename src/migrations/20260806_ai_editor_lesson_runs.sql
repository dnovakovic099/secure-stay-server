-- Daily Editor optimize runs: distilled lessons from yesterday's AI misses.
CREATE TABLE IF NOT EXISTS `ai_editor_lesson_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `dayEt` VARCHAR(10) NOT NULL,
  `missCount` INT NOT NULL DEFAULT 0,
  `categoryBreakdown` TEXT NULL,
  `summary` TEXT NULL,
  `lessonsJson` MEDIUMTEXT NULL,
  `modelName` VARCHAR(64) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_editor_lesson_runs_day` (`dayEt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
