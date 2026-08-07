ALTER TABLE listing_details
  ADD COLUMN client_maintenance_requirements TEXT NULL AFTER client_reservation_requirements,
  ADD COLUMN client_other_requirements TEXT NULL AFTER client_maintenance_requirements;
