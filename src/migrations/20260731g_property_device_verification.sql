-- Migration: Track how a lock-to-unit mapping was established
-- Date: 2026-07-31
-- Description: Mappings were inherited from Seam with no record of who decided
--              a given lock opens a given unit. Getting one wrong hands a guest
--              the key to someone else's door, so record the basis for each
--              mapping and let a rep confirm it against the physical property.
--
--              evidence_matched means we inferred it by reading the passcodes
--              programmed on the lock and matching them to the phone numbers of
--              guests who stayed at that listing. confirmed means a person
--              checked. Existing rows stay unverified until someone looks.
--
-- IMPORTANT: Do not put semicolons inside string values. The migration runner
-- splits statements on ';' after stripping -- comments.

ALTER TABLE property_devices
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(24) NOT NULL DEFAULT 'unverified';

ALTER TABLE property_devices
    ADD COLUMN IF NOT EXISTS verification_note TEXT NULL;

ALTER TABLE property_devices
    ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(255) NULL;

ALTER TABLE property_devices
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL;
