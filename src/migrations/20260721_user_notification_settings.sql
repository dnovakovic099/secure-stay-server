-- Per-user notification + sound preferences (and last-seen cursor for unread).

CREATE TABLE IF NOT EXISTS `user_notification_settings` (
  `userUid` VARCHAR(64) NOT NULL,
  `notificationsEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `soundEnabled` TINYINT(1) NOT NULL DEFAULT 1,
  `notifyMessages` TINYINT(1) NOT NULL DEFAULT 1,
  `notifyReservations` TINYINT(1) NOT NULL DEFAULT 1,
  `notifyActionItems` TINYINT(1) NOT NULL DEFAULT 1,
  `lastSeenAt` DATETIME NULL,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`userUid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
