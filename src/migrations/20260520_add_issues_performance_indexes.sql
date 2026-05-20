-- Performance indexes for issues table and file_info table
-- Addresses slow issues page load especially when filters are applied.
-- Safe to run repeatedly (IF NOT EXISTS guards require MariaDB 10.1.4+).
-- Run during a maintenance window on large tables; InnoDB supports ALGORITHM=INPLACE.

ALTER TABLE `issues`
  ADD INDEX `IDX_issues_status` (`status`),
  ADD INDEX `IDX_issues_listing_id` (`listing_id`),
  ADD INDEX `IDX_issues_created_at` (`created_at`),
  ADD INDEX `IDX_issues_updated_at` (`updated_at`),
  ADD INDEX `IDX_issues_completed_at` (`completed_at`),
  ADD INDEX `IDX_issues_due_date` (`due_date`),
  ADD INDEX `IDX_issues_assignee` (`assignee`),
  ADD INDEX `IDX_issues_category` (`category`),
  ADD INDEX `IDX_issues_channel` (`channel`),
  ADD INDEX `IDX_issues_urgency` (`urgency`),
  ADD INDEX `IDX_issues_reservation_id` (`reservation_id`),
  ADD INDEX `IDX_issues_status_listing_created` (`status`, `listing_id`, `created_at`);

-- Supports scoped file_info lookups by entity type + ID (fixes full table scan on file_info)
ALTER TABLE `file_info`
  ADD INDEX `IDX_file_info_entity_type_id` (`entityType`, `entityId`);
