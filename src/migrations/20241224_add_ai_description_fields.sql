-- Migration: Add AI description fields to property_info table
-- Date: 2024-12-24

ALTER TABLE property_info
ADD COLUMN theSpace TEXT NULL;

ALTER TABLE property_info
ADD COLUMN theNeighborhood TEXT NULL;

ALTER TABLE property_info
ADD COLUMN houseRulesText TEXT NULL;

ALTER TABLE property_info
ADD COLUMN houseManualText TEXT NULL;

ALTER TABLE property_info
ADD COLUMN summaryText TEXT NULL;

ALTER TABLE property_info
ADD COLUMN guestAccessText TEXT NULL;

ALTER TABLE property_info
ADD COLUMN interactionWithGuestsText TEXT NULL;

ALTER TABLE property_info
ADD COLUMN otherThingsToNoteText TEXT NULL;
