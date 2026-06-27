-- Migration: Add audit-lookup indexes on review_checkout_updates
-- Date: 2026-06-27
--
-- The mitigation list now sources its "Updated By/On" column AND the corresponding
-- Updated By / Updated On filters from review_checkout_updates rather than
-- reservation_info_logs. Two new queries hit this table on every mitigation request:
--
--   1. Per-row latest update lookup (already fast via the FK index added on 06-26).
--   2. Filter scans:
--        WHERE update.deletedAt IS NULL AND DATE(update.updatedAt) BETWEEN ... AND ...
--        WHERE update.createdBy IN (...)
--        WHERE update.updatedBy IN (...)
--
-- Without dedicated indexes those filters fall back to table scans on production with
-- millions of update rows. The two indexes below cover both predicates.

-- Covers the "Updated On" date-range filter — composite of deletedAt + updatedAt lets
-- MySQL satisfy both the soft-delete check and the range scan from one B-tree.
CREATE INDEX idx_review_checkout_updates_deleted_updated ON review_checkout_updates(deletedAt, updatedAt);

-- Covers the "Updated By" user filter — separate indexes on each author column so
-- the OR-of-IN match in the filter can use either branch.
CREATE INDEX idx_review_checkout_updates_created_by ON review_checkout_updates(createdBy);
CREATE INDEX idx_review_checkout_updates_updated_by ON review_checkout_updates(updatedBy);
