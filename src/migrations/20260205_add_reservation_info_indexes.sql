-- Migration: Add indexes to reservation_info table for performance optimization
-- Date: 2026-02-05
-- Purpose: Speed up reservation queries on the /reservations page
-- Note: If index already exists, the statement will fail (expected on re-run)

-- Index for arrival date queries (check-in filtering, ordering)
CREATE INDEX idx_reservation_info_arrival_status ON reservation_info(arrivalDate, status);

-- Index for departure date queries (check-out filtering)
CREATE INDEX idx_reservation_info_departure_status ON reservation_info(departureDate, status);

-- Index for listing-based filtering combined with date
CREATE INDEX idx_reservation_info_listing_arrival ON reservation_info(listingMapId, arrivalDate);

-- Index for status filtering
CREATE INDEX idx_reservation_info_status ON reservation_info(status);
