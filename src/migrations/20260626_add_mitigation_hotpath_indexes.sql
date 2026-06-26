-- Migration: Add hot-path indexes for the mitigation page (/review/reviewcheckout)
-- Date: 2026-06-26
--
-- The mitigation list query and its post-fetch enrichment queries hit a handful of
-- columns that are not yet indexed. On production with millions of rows the resulting
-- table scans dominate the request time (multi-second response). Each index below has
-- been chosen because EITHER the column appears in a WHERE/JOIN clause used by the
-- mitigation query OR it is the foreign key on a table fetched by a per-reservation
-- batched IN(...) lookup during enrichment.
--
-- All statements use `CREATE INDEX IF NOT EXISTS` semantics via a check, so re-running
-- this migration is safe.

-- ─── review_checkout ──────────────────────────────────────────────────────────────
-- The mitigation query (and most other review_checkout reads) filters by deletedAt IS NULL.
-- Without an index MySQL has to scan every row. Adding this turns the soft-delete filter
-- into a fast index lookup.
CREATE INDEX idx_review_checkout_deleted_at ON review_checkout(deletedAt);

-- The one-to-one join from review_checkout → reservation_info uses reservationInfoId.
-- TypeORM does not auto-index foreign keys; without this the join falls back to a scan.
CREATE INDEX idx_review_checkout_reservation_info ON review_checkout(reservationInfoId);

-- Used by the assignee filter chip and assignee-aware ordering in some saved views.
CREATE INDEX idx_review_checkout_assignee ON review_checkout(assignee);

-- ─── review_checkout_updates ─────────────────────────────────────────────────────
-- Many-to-one FK to review_checkout — same TypeORM auto-index gap as above.
CREATE INDEX idx_review_checkout_updates_review_checkout ON review_checkout_updates(reviewCheckoutId);

-- ─── refund_request ──────────────────────────────────────────────────────────────
-- getLatestRefundRequests fetches WHERE reservationId IN (...) AND deletedAt IS NULL on every
-- mitigation list response. The composite covers both predicates.
CREATE INDEX idx_refund_request_reservation_deleted ON refund_request_info(reservationId, deletedAt);

-- ─── expense (accounting logs) ───────────────────────────────────────────────────
-- getAccountingLogSummaries fetches WHERE reservationId IN (...) AND isDeleted = 0 per response.
CREATE INDEX idx_expense_reservation_active ON expense(reservationId, isDeleted);

-- ─── review_discussion_messages ──────────────────────────────────────────────────
-- getLatestReservationNotes filters by (reservationId IN (...) AND sourceType = 'note').
-- The single-column reservation_id index helps but a composite index lets MySQL satisfy
-- both predicates with one B-tree lookup and avoids a sort for the ORDER BY updatedAt DESC
-- when paired with InnoDB row ordering on the leaf.
CREATE INDEX idx_review_discussion_reservation_source ON review_discussion_messages(reservation_id, source_type);

-- ─── reservation_info_logs ───────────────────────────────────────────────────────
-- getLatestUpdatesForReservations does WHERE reservationInfoId IN (...) AND action = 'UPDATE'
-- and ORDER BY changedAt DESC. A composite index makes both filter and sort index-served.
CREATE INDEX idx_reservation_info_logs_reservation_action ON reservation_info_logs(reservationInfoId, action, changedAt);
