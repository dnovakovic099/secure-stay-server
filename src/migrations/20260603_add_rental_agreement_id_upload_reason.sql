ALTER TABLE rental_agreement_reservation_documents
  ADD COLUMN skipIdUploadReason TEXT NULL AFTER skipIdUploadBy;
