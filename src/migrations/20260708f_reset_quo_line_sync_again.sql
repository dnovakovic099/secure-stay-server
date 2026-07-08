-- Quo's /conversations list is NOT ordered by last activity, so the previous
-- deep backfill's "stop paging once conversations look old" bail silently
-- dropped most threads (PM CLIENTS: 36 imported vs 403 real; GR G1: 264 vs
-- 3166 — verified against the live API 2026-07-08). The sync now filters with
-- updatedAfter and walks every page. Reset the stamps so the next sweep runs
-- the corrected deep backfill on all lines.
UPDATE `quo_phone_lines` SET `lastSyncedAt` = NULL;
