CREATE TABLE IF NOT EXISTS `maintenance_form_requests` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `property_id` INT NOT NULL,
    `budget` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `scopeOfWork` TEXT NULL,
    `propertyAccessInformation` TEXT NULL,
    `expectedTimeframe` VARCHAR(255) NULL,
    `status` VARCHAR(255) NULL DEFAULT 'new',
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `createdBy` VARCHAR(255) NULL,
    `updatedBy` VARCHAR(255) NULL,
    PRIMARY KEY (`id`),
    INDEX `idx_maintenance_form_requests_property_id` (`property_id`),
    INDEX `idx_maintenance_form_requests_status` (`status`),
    CONSTRAINT `fk_maintenance_form_requests_property` FOREIGN KEY (`property_id`) REFERENCES `client_properties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
