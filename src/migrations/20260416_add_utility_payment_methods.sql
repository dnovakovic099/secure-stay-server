CREATE TABLE utility_payment_method (
    id INT NOT NULL AUTO_INCREMENT,
    label VARCHAR(120) NOT NULL,
    sortOrder INT NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deletedAt TIMESTAMP NULL,
    createdBy VARCHAR(255) NULL,
    updatedBy VARCHAR(255) NULL,
    deletedBy VARCHAR(255) NULL,
    PRIMARY KEY (id)
);

INSERT INTO utility_payment_method (label, sortOrder, isActive)
VALUES
    ('ACH', 0, 1),
    ('Credit Card', 1, 1),
    ('Check', 2, 1),
    ('Wire', 3, 1);
