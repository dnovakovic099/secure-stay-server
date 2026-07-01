-- Maps Hostify's channel-split listing IDs to a single canonical property group
-- (parent listing) so the assistant can share Knowledge Base + learned facts
-- across all sibling listings of the same real property.
CREATE TABLE IF NOT EXISTS `listing_group_map` (
    `listingId` BIGINT NOT NULL,
    `groupId` BIGINT NOT NULL,
    `name` VARCHAR(255) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`listingId`),
    INDEX `idx_lgm_group` (`groupId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
