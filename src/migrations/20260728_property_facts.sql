-- Verified Property Facts layer: preset per-property fields (top of the AI
-- knowledge hierarchy) plus the correction-proposal queue that fills them.

CREATE TABLE IF NOT EXISTS property_facts (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    listingId BIGINT NOT NULL,
    fieldKey VARCHAR(64) NOT NULL,
    value TEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'unverified',
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    verifiedByUserId BIGINT NULL,
    verifiedAt DATETIME NULL,
    updatedByUserId BIGINT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_property_facts_listing_field (listingId, fieldKey),
    KEY idx_property_facts_listing (listingId),
    KEY idx_property_facts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_fact_proposals (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    listingId BIGINT NOT NULL,
    fieldKey VARCHAR(64) NOT NULL,
    currentValue TEXT NULL,
    proposedValue TEXT NOT NULL,
    sourceType VARCHAR(32) NOT NULL,
    sourceId BIGINT NULL,
    evidence MEDIUMTEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    reviewedByUserId BIGINT NULL,
    reviewedAt DATETIME NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_pfp_listing (listingId),
    KEY idx_pfp_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
