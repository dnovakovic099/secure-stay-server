-- Migration: Add hot-path indexes for the /issues endpoint (Guest Issues page)
-- Date: 2026-07-24
--
-- The Guest Issues page currently sees 40–50s response times per /issues call,
-- amplified by the status-count fan-out (one call per status × 5). Profiling the
-- getGuestIssues service (services/IssuesService.ts) surfaces two hot paths that
-- are not covered by existing indexes:
--
--   1. The reservation lookup used when dateType=check_in|check_out or when the
--      stayStatus filter is set (i.e. the "CI today" / "Upcoming" / "Past" nav
--      tabs). That query SELECTs from reservation_info WHERE arrivalDate ∈ range
--      or departureDate ∈ range and LEFT JOINs listing ON listing.id =
--      reservation_info.listingMapId. Without indexes on arrivalDate,
--      departureDate, and listingMapId this becomes a full scan of the
--      reservation_info table on every tab click.
--
--   2. The issue-updates batch load fetches issues_updates WHERE issueId IN (...)
--      for every page of results. TypeORM does not auto-index foreign keys on
--      MySQL, so this falls back to a full-table scan of issues_updates on every
--      request.
--
-- Migration history tracking (migrations_history) prevents re-execution, so
-- these do not need CREATE INDEX IF NOT EXISTS guards.

-- ─── reservation_info ────────────────────────────────────────────────────────
-- Range filter on arrival date drives the "Check-in Today" / "Upcoming" tabs.
CREATE INDEX idx_reservation_info_arrival_date ON reservation_info(arrivalDate);

-- Range filter on departure date drives the "Check-out Today" / "Past" tabs.
CREATE INDEX idx_reservation_info_departure_date ON reservation_info(departureDate);

-- LEFT JOIN listing ON listing.id = reservation_info.listingMapId in the stay
-- timing query, plus most reservation-info reads across the app. TypeORM auto-
-- index gap: this FK is not indexed by default on MySQL.
CREATE INDEX idx_reservation_info_listing_map ON reservation_info(listingMapId);

-- ─── issues_updates ──────────────────────────────────────────────────────────
-- Every /issues response batch-loads issues_updates WHERE issueId IN (...).
-- Without this index the batch load scans the full issues_updates table.
CREATE INDEX idx_issues_updates_issue ON issues_updates(issueId);
