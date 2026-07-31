-- Migration: Smart Lock command center
-- Date: 2026-07-31
-- Description: Adds provider health tracking, device sync/telemetry columns, and
--              access-code attribution so the Locks page can show API status,
--              last-sync times, live device state, and who set each code.

-- Table: lock_provider_status
-- One row per lock provider. Records the outcome of the most recent health check
-- and the most recent device sync so the UI can show whether each integration is
-- actually working rather than just configured.
CREATE TABLE IF NOT EXISTS lock_provider_status (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    is_configured BOOLEAN DEFAULT FALSE,
    last_checked_at TIMESTAMP NULL,
    last_success_at TIMESTAMP NULL,
    last_sync_at TIMESTAMP NULL,
    last_sync_device_count INT DEFAULT 0,
    latency_ms INT NULL,
    consecutive_failures INT DEFAULT 0,
    last_error TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_lock_provider (provider)
);

-- Device telemetry. The ILockProvider Device interface already returns these
-- fields but they were being discarded on upsert, so the UI had no way to show
-- battery or lock state.
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS battery_level DECIMAL(5,4) NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS battery_status VARCHAR(20) NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(120) NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS image_url VARCHAR(512) NULL;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE smart_lock_devices ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP NULL;

-- Access-code attribution and retry tracking. `set_by` records the operator who
-- pushed a manual code so the audit trail survives a support escalation.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS set_by VARCHAR(255) NULL;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP NULL;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_smart_lock_devices_provider ON smart_lock_devices(provider);
CREATE INDEX IF NOT EXISTS idx_smart_lock_devices_last_synced ON smart_lock_devices(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_access_codes_device_status ON access_codes(device_id, status);
CREATE INDEX IF NOT EXISTS idx_access_codes_check_out ON access_codes(check_out_date);
