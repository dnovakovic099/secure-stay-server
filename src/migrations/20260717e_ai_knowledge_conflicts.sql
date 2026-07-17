-- Conflict detector: contradictions between the three sources the AI answers
-- from — live listing data (authoritative), learned Q&A facts, and Knowledge
-- Base entries. Example: listing says check-out 10 AM, a taught fact says
-- 11 AM. Each row is one contradicting pair; dedupeKey keeps re-scans from
-- duplicating, dismissed rows stay dismissed.
CREATE TABLE IF NOT EXISTS `ai_knowledge_conflicts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `listingId` BIGINT NULL,
    `listingName` VARCHAR(255) NULL,
    `topic` VARCHAR(120) NULL,
    `severity` VARCHAR(12) NOT NULL DEFAULT 'medium',
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `dedupeKey` VARCHAR(160) NOT NULL,
    `sourceAType` VARCHAR(20) NOT NULL,
    `sourceAId` BIGINT NULL,
    `sourceALabel` VARCHAR(255) NULL,
    `sourceAText` TEXT NULL,
    `sourceBType` VARCHAR(20) NOT NULL,
    `sourceBId` BIGINT NULL,
    `sourceBLabel` VARCHAR(255) NULL,
    `sourceBText` TEXT NULL,
    `explanation` TEXT NULL,
    `suggestedFix` TEXT NULL,
    `dismissedByUserId` INT NULL,
    `resolvedAt` DATETIME NULL,
    `lastSeenAt` DATETIME NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `UQ_ai_knowledge_conflicts_dedupe` (`dedupeKey`),
    INDEX `IDX_ai_knowledge_conflicts_status` (`status`, `severity`),
    INDEX `IDX_ai_knowledge_conflicts_listing` (`listingId`)
);

-- Per-listing scan cache: hash of every knowledge source feeding a listing.
-- Unchanged hash = skip the LLM call on the next sweep, so nightly scans only
-- pay for listings whose facts/KB/listing data actually changed.
CREATE TABLE IF NOT EXISTS `ai_conflict_scans` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `listingId` BIGINT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `conflictsFound` INT NOT NULL DEFAULT 0,
    `scannedAt` DATETIME NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `UQ_ai_conflict_scans_listing` (`listingId`)
);
