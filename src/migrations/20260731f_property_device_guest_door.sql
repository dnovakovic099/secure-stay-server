-- Migration: Mark which mapped locks are guest-facing
-- Date: 2026-07-31
-- Description: Automated reservation codes were pushed to every active lock
--              mapped to a property, including service doors. A guest checking
--              in today was given the code to an electrical room and a supply
--              closet for the length of their stay. Guest codes must only go to
--              doors the guest is meant to open.
--
--              Defaults to TRUE so existing mappings keep working, then clears
--              the flag for the unambiguous service doors. Laundry rooms are
--              deliberately left as guest doors - shared laundry is usually a
--              guest amenity - and anything else ops considers off-limits can be
--              turned off per mapping.
--
-- IMPORTANT: Do not put semicolons inside string values. The migration runner
-- splits statements on ';' after stripping -- comments.

ALTER TABLE property_devices
    ADD COLUMN IF NOT EXISTS is_guest_door BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE property_devices pd
JOIN smart_lock_devices d ON d.id = pd.device_id
SET pd.is_guest_door = FALSE
WHERE d.device_name REGEXP '(supply|supplies|electrical|mechanical|boiler|janitor|utility|maintenance|storage)';
