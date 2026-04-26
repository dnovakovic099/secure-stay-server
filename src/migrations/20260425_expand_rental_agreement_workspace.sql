ALTER TABLE `rental_agreement_templates`
    ADD COLUMN `headerHtml` LONGTEXT NULL AFTER `bodyHtml`,
    ADD COLUMN `footerHtml` LONGTEXT NULL AFTER `headerHtml`;

CREATE TABLE IF NOT EXISTS `rental_agreement_reservation_documents` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `hostifyReservationId` VARCHAR(200) NOT NULL,
    `reservationInfoId` INT NULL,
    `sourceTemplateId` INT NULL,
    `headerHtml` LONGTEXT NULL,
    `bodyHtml` LONGTEXT NULL,
    `footerHtml` LONGTEXT NULL,
    `emailSubject` VARCHAR(255) NULL,
    `emailBodyHtml` LONGTEXT NULL,
    `isEdited` TINYINT(1) NOT NULL DEFAULT 0,
    `isOverridden` TINYINT(1) NOT NULL DEFAULT 0,
    `overriddenAt` TIMESTAMP NULL,
    `overriddenBy` VARCHAR(255) NULL,
    `lastEditedAt` TIMESTAMP NULL,
    `lastEditedBy` VARCHAR(255) NULL,
    `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_rard_hostify_reservation_id` (`hostifyReservationId`),
    KEY `idx_rard_reservation_info_id` (`reservationInfoId`),
    KEY `idx_rard_source_template_id` (`sourceTemplateId`),
    KEY `idx_rard_is_edited` (`isEdited`),
    KEY `idx_rard_is_overridden` (`isOverridden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
