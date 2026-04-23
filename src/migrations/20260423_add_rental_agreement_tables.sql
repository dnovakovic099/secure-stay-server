CREATE TABLE IF NOT EXISTS `rental_agreement_templates` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `bodyHtml` LONGTEXT NOT NULL,
    `isActive` TINYINT(1) NOT NULL DEFAULT 1,
    `isDefault` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `createdBy` VARCHAR(255) NULL,
    `updatedBy` VARCHAR(255) NULL,
    PRIMARY KEY (`id`),
    INDEX `idx_rat_is_active` (`isActive`),
    INDEX `idx_rat_is_default` (`isDefault`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rental_agreement_signings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `hostifyReservationId` VARCHAR(200) NOT NULL,
    `reservationInfoId` INT NULL,
    `templateId` INT NOT NULL,
    `renderedHtml` LONGTEXT NOT NULL,
    `signatureDataUrl` MEDIUMTEXT NOT NULL,
    `signedByName` VARCHAR(200) NOT NULL,
    `signedByEmail` VARCHAR(200) NULL,
    `ipAddress` VARCHAR(50) NULL,
    `userAgent` VARCHAR(512) NULL,
    `signedAt` TIMESTAMP NOT NULL,
    `fileInfoId` INT NULL,
    `pdfStatus` VARCHAR(50) NOT NULL DEFAULT 'pending_pdf',
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_ras_hostify_reservation_id` (`hostifyReservationId`),
    INDEX `idx_ras_reservation_info_id` (`reservationInfoId`),
    INDEX `idx_ras_template_id` (`templateId`),
    INDEX `idx_ras_pdf_status` (`pdfStatus`),
    CONSTRAINT `fk_ras_template` FOREIGN KEY (`templateId`) REFERENCES `rental_agreement_templates` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
