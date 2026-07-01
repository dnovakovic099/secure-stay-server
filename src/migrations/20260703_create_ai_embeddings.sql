-- Semantic index over real data (primarily guest question -> team answer pairs)
-- so the assistant retrieves the most relevant proven answers instead of ranking
-- by keyword overlap. Vectors stored as JSON; cosine computed in-process over a
-- small, group-scoped candidate set.
CREATE TABLE IF NOT EXISTS `ai_embeddings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `refId` BIGINT NULL,
    `listingId` BIGINT NULL,
    `groupId` BIGINT NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'property',
    `embeddedText` MEDIUMTEXT NOT NULL,
    `payload` MEDIUMTEXT NULL,
    `vector` LONGTEXT NOT NULL,
    `model` VARCHAR(64) NULL,
    `dedupKey` VARCHAR(200) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_emb_kind_group` (`kind`, `groupId`),
    INDEX `idx_emb_kind_listing` (`kind`, `listingId`),
    INDEX `idx_emb_dedup` (`dedupKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
