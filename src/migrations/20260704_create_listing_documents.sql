-- Listing documents: uploaded manuals/guides/policy sheets/spreadsheets that
-- feed the AI assistant. Text is extracted, chunked, and embedded into
-- ai_embeddings (kind='doc'); chunks carry the doc's visibility.

CREATE TABLE IF NOT EXISTS `listing_documents` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `listingId` BIGINT NOT NULL,
    `groupId` BIGINT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NULL,
    `mimeType` VARCHAR(128) NULL,
    `storagePath` VARCHAR(512) NULL,
    `sizeBytes` INT NULL,
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'internal',
    `status` VARCHAR(16) NOT NULL DEFAULT 'processing',
    `errorMessage` VARCHAR(500) NULL,
    `charCount` INT NULL,
    `chunkCount` INT NULL,
    `extractedText` LONGTEXT NULL,
    `uploadedByUserId` INT NULL,
    `uploadedByName` VARCHAR(255) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_ldoc_listing` (`listingId`),
    INDEX `idx_ldoc_group` (`groupId`),
    INDEX `idx_ldoc_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Visibility on embeddings so 'doc' chunks can be split into guest-shareable
-- vs staff-only at retrieval time. Guard against re-run since MariaDB lacks
-- ADD COLUMN IF NOT EXISTS on older versions.
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_embeddings' AND COLUMN_NAME = 'visibility'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE `ai_embeddings` ADD COLUMN `visibility` VARCHAR(16) NULL',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
