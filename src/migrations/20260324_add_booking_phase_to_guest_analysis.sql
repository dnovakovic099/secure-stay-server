ALTER TABLE guest_analysis
ADD COLUMN bookingPhase VARCHAR(32) NULL AFTER analyzedBy;

UPDATE guest_analysis ga
LEFT JOIN reservation_info ri ON ri.id = ga.reservationId
SET ga.bookingPhase = CASE
    WHEN ri.arrivalDate IS NOT NULL AND DATE(ga.analyzedAt) < ri.arrivalDate THEN 'inquiry'
    WHEN ri.departureDate IS NOT NULL AND DATE(ga.analyzedAt) > ri.departureDate THEN 'after_stay'
    ELSE 'during_stay'
END
WHERE ga.bookingPhase IS NULL;

ALTER TABLE guest_analysis
MODIFY COLUMN bookingPhase VARCHAR(32) NOT NULL DEFAULT 'during_stay';

CREATE INDEX idx_guest_analysis_booking_phase ON guest_analysis (bookingPhase);
