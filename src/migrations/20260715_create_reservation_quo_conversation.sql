-- Join table for Hostify reservation ↔ Quo conversation (many-to-many).
--
-- quo_conversations.reservationId already carries the "primary" auto-linked
-- Quo thread for a reservation (matched by guest phone during Quo sync). This
-- table stores additional attachments — a guest that reaches out from a second
-- phone number gets a second Quo conversation, and staff can attach it to the
-- same reservation from the v2 inbox so both threads show up as tabs under the
-- same Hostify thread.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE TABLE `reservation_quo_conversation` (
        `reservationId` BIGINT NOT NULL,
        `quoConversationId` VARCHAR(64) NOT NULL,
        `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        `createdBy` VARCHAR(255) NULL,
        PRIMARY KEY (`reservationId`, `quoConversationId`),
        INDEX `idx_rqc_quo_conversation` (`quoConversationId`)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reservation_quo_conversation'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
