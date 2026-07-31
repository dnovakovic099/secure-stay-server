-- The assistant's history search looks for keywords in guest messages for one
-- property. listingId was unindexed, so that query had to scan the table.
CREATE INDEX IF NOT EXISTS idx_inbox_messages_listing_sent
  ON inbox_messages (listingId, sentAt);
