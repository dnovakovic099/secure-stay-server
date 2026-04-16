ALTER TABLE utility_provider
    ADD COLUMN lastpass TINYINT(1) NOT NULL DEFAULT 0 AFTER password,
    ADD COLUMN propertyLinks LONGTEXT NULL AFTER propertyIds;
