-- Migration: Add indexes to action_items table for performance optimization
-- Date: 2026-02-13
-- Purpose: Speed up action items queries on the /action-items page

-- Index for listing and status combinations (common filtering)
CREATE INDEX IDX_action_items_listing_status ON action_items(`listingId`, `status`);

-- Index for createdAt (default ordering)
CREATE INDEX IDX_action_items_createdAt ON action_items(`createdAt`);

-- Index for category filtering
CREATE INDEX IDX_action_items_category ON action_items(`category`);
