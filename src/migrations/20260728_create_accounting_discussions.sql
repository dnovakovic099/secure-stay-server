CREATE TABLE IF NOT EXISTS accounting_discussions (
    id INT NOT NULL AUTO_INCREMENT,
    entityType VARCHAR(20) NOT NULL,
    entityId INT NOT NULL,
    message TEXT NOT NULL,
    createdBy VARCHAR(255) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_accounting_discussions_entity (entityType, entityId, createdAt)
);
