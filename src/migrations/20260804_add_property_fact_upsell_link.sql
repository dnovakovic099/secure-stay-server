ALTER TABLE property_facts
    ADD COLUMN linkedUpsellId BIGINT NULL AFTER internalInstructions,
    ADD INDEX idx_property_facts_linked_upsell (linkedUpsellId);
