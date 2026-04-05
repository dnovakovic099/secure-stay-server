-- Backfill listingMapId for Hostify reviews where the stored value is a Hostify listing ID
-- (which doesn't match the listings table's HostAway-based primary key).
-- We join reviews to reservation_info via reservationId and copy reservation_info.listingMapId.
-- Only updates rows where the current listingMapId does NOT match any listing in the listings table,
-- ensuring we don't overwrite correctly-set HostAway review listingMapIds.

UPDATE reviews r
INNER JOIN reservation_info ri ON ri.id = r.reservationId
SET r.listingMapId = ri.listingMapId
WHERE r.reservationId IS NOT NULL
  AND ri.listingMapId IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM listing_info l WHERE l.id = r.listingMapId
  );
