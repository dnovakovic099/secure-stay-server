-- The first Quo sync only pulled ~100 recent conversations per line before
-- stamping lastSyncedAt, which permanently skipped older history. Resetting
-- the stamp makes the next sync sweep treat every line as brand new and run
-- the full deep backfill (QUO_BACKFILL_DAYS window).
UPDATE `quo_phone_lines` SET `lastSyncedAt` = NULL;
