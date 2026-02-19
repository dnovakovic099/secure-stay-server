-- Migration: Create thread_messages table for GR Tasks Updates & Discussion
-- Date: 2026-02-19
-- 
-- This table stores messages posted from SecureStay to GR Task threads.
-- Slack thread replies are fetched live from the Slack API and not stored here.

CREATE TABLE IF NOT EXISTS `thread_messages` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `gr_task_id` INT NOT NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'securestay',
    `user_name` VARCHAR(255) NOT NULL,
    `user_avatar` VARCHAR(500) NULL,
    `content` TEXT NOT NULL,
    `slack_message_ts` VARCHAR(50) NULL,
    `message_timestamp` DATETIME NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_thread_messages_gr_task_id` (`gr_task_id`),
    INDEX `idx_thread_messages_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
