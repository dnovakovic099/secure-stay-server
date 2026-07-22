-- Portfolio / city vendor memory for IR Copilot.
-- Built from completed Guest Issues + listing contacts, taught by human feedback.

CREATE TABLE IF NOT EXISTS `ir_vendor_memory` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `vendorName` VARCHAR(255) NOT NULL,
  `normalizedName` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(64) NULL,
  `email` VARCHAR(255) NULL,
  `category` VARCHAR(128) NULL,
  `city` VARCHAR(128) NULL,
  `role` VARCHAR(128) NULL,
  `useCount` INT NOT NULL DEFAULT 1,
  `lastUsedAt` DATETIME NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'issue',
  `sourceIssueId` INT NULL,
  `notes` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ir_vendor_memory_city_cat_name` (`city`, `category`, `normalizedName`),
  KEY `idx_ir_vendor_memory_city_cat` (`city`, `category`),
  KEY `idx_ir_vendor_memory_normalized` (`normalizedName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
