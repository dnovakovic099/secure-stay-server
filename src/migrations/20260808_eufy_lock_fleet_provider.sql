-- Migration: Route Eufy locks through the new eufy provider
-- Date: 2026-08-08
-- Description: The 2 Eufy Security locks in the fleet were marked `replace`
--              back in the 20260731e migration because "eufy-security-client
--              has no viable API." Research (Aug 2026) showed the library
--              does expose full passcode CRUD via device.addUser /
--              updateUser / updateUserPasscode / deleteUser, and the T85D0
--              (Smart Lock C30) that the fleet holds is a supported model.
--              Un-mark those rows and point them at the new provider.
--
-- IMPORTANT: Do not put semicolons inside string values. The migration runner
-- splits statements on ';' after stripping -- comments.

UPDATE lock_fleet_inventory
SET provider = 'eufy',
    automation_path = 'api',
    notes = 'eufy-security-client - consumer cloud via bropat/eufy-security-client; requires EUFY_ACCOUNTS_JSON secret'
WHERE platform = 'eufy Security';
