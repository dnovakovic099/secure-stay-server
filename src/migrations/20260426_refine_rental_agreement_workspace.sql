ALTER TABLE `rental_agreement_reservation_documents`
    ADD COLUMN `overrideReason` TEXT NULL AFTER `isOverridden`,
    ADD COLUMN `firstViewedAt` TIMESTAMP NULL AFTER `lastEditedBy`,
    ADD COLUMN `lastViewedAt` TIMESTAMP NULL AFTER `firstViewedAt`,
    ADD KEY `idx_rard_first_viewed_at` (`firstViewedAt`),
    ADD KEY `idx_rard_last_viewed_at` (`lastViewedAt`);
