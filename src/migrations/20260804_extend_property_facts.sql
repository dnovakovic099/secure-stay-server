ALTER TABLE property_facts
    ADD COLUMN hostifyValue VARCHAR(64) NULL AFTER value,
    ADD COLUMN internalInstructions TEXT NULL AFTER hostifyValue;
