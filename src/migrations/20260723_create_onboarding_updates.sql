CREATE TABLE IF NOT EXISTS onboarding_updates (
  id INT NOT NULL AUTO_INCREMENT,
  propertyId INT NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'user',
  eventType VARCHAR(80) NULL,
  metadata JSON NULL,
  createdBy VARCHAR(255) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX IDX_onboarding_updates_property (propertyId),
  INDEX IDX_onboarding_updates_created (createdAt),
  CONSTRAINT FK_onboarding_updates_property
    FOREIGN KEY (propertyId) REFERENCES client_properties(id) ON DELETE CASCADE
);
