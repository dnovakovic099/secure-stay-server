ALTER TABLE rental_agreement_reservation_documents
  ADD COLUMN signatureTimestampOverrideAt TIMESTAMP NULL,
  ADD COLUMN signatureTimezoneOverride VARCHAR(100) NULL,
  ADD COLUMN signatureTimestampOverrideUpdatedAt TIMESTAMP NULL,
  ADD COLUMN signatureTimestampOverrideUpdatedBy VARCHAR(255) NULL;
