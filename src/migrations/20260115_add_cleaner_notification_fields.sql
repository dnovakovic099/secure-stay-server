-- Add cleaner notification fields to support SMS notifications on checkout

-- Add isPrimary flag to contact table
ALTER TABLE contact 
ADD COLUMN isPrimary BOOLEAN DEFAULT FALSE 
COMMENT 'Marks which cleaner is the primary contact for SMS notifications';

-- Add cleaner notification fields to reservation_detail_post_stay_audit
ALTER TABLE reservation_detail_post_stay_audit
ADD COLUMN cleanerNotificationContactId INT NULL 
COMMENT 'Override cleaner contact for this specific reservation',
ADD COLUMN cleanerNotificationStatus ENUM('pending', 'sent', 'failed', 'skipped') NULL 
COMMENT 'Status of cleaner SMS notification',
ADD COLUMN cleanerNotificationSentAt TIMESTAMP NULL 
COMMENT 'When the cleaner SMS was sent',
ADD COLUMN cleanerNotificationError TEXT NULL 
COMMENT 'Error message if SMS send failed or was skipped';

-- Add foreign key constraint
ALTER TABLE reservation_detail_post_stay_audit
ADD CONSTRAINT fk_cleaner_notification_contact
FOREIGN KEY (cleanerNotificationContactId) REFERENCES contact(id)
ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX idx_contact_primary ON contact(listingId, role, isPrimary);
CREATE INDEX idx_reservation_cleaner_notification_status ON reservation_detail_post_stay_audit(cleanerNotificationStatus);
