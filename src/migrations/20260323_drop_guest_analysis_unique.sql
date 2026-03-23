-- Drop unique constraint on guest_analysis.reservationId
-- This allows multiple analysis records per reservation (full history)
ALTER TABLE guest_analysis DROP INDEX unique_reservation_analysis;
