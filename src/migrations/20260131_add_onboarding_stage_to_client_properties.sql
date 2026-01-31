-- Add onboarding_stage column to client_properties table
-- Migration: 20260131_add_onboarding_stage_to_client_properties

ALTER TABLE client_properties 
ADD COLUMN onboarding_stage VARCHAR(255) DEFAULT 'Phase 1: Information Gathering';

-- Set existing properties to default stage if null
UPDATE client_properties 
SET onboarding_stage = 'Phase 1: Information Gathering' 
WHERE onboarding_stage IS NULL;
