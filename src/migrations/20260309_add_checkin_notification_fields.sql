ALTER TABLE reservation_detail_pre_stay_audit
ADD COLUMN notificationContactId INT NULL,
ADD COLUMN notificationStatus ENUM('pending', 'sent', 'failed', 'skipped', 'paused') DEFAULT 'pending',
ADD COLUMN notificationSentAt TIMESTAMP NULL,
ADD COLUMN notificationError TEXT NULL;
