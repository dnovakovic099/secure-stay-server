ALTER TABLE listing_details
  ADD COLUMN comfortable_capacity INT NULL,
  MODIFY COLUMN propertyOwnershipType VARCHAR(255) NULL;
