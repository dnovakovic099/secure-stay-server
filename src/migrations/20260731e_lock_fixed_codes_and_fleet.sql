-- Migration: Fixed door codes + fleet inventory
-- Date: 2026-07-31
-- Description: Properties that use a permanent code (ADT, CPI, NGTeco, etc.)
--              don't need API automation — they need a documented code the
--              Locks page can show. Also seeds the expected fleet inventory
--              so operators can see coverage gaps before every lock is synced.

CREATE TABLE IF NOT EXISTS lock_fixed_codes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    property_name VARCHAR(255) NOT NULL,
    property_id INT NULL,
    platform VARCHAR(80) NOT NULL,
    code VARCHAR(40) NOT NULL,
    notes TEXT,
    account_email VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_fixed_code_property_platform (property_name, platform)
);

CREATE TABLE IF NOT EXISTS lock_fleet_inventory (
    id INT PRIMARY KEY AUTO_INCREMENT,
    platform VARCHAR(80) NOT NULL,
    expected_count INT NOT NULL DEFAULT 0,
    provider VARCHAR(50) NULL,
    automation_path VARCHAR(40) NOT NULL DEFAULT 'api',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_fleet_platform (platform)
);

INSERT IGNORE INTO lock_fleet_inventory (platform, expected_count, provider, automation_path, notes) VALUES
('Schlage Encode', 37, 'schlage', 'api', 'Allegion consumer cloud via pyschlage bridge; apply for official partner API in parallel'),
('Sifely', 34, 'sifely', 'api', 'Sifely portal API — already implemented'),
('DD Lock', 3, 'ttlock', 'api', 'TTLock/Sciener OEM — covered by ttlock provider'),
('TTLock', 2, 'ttlock', 'api', 'TTLock Open Platform'),
('August Home', 2, NULL, 'replace', 'Partner-gated; replace with TTLock-compatible hardware'),
('eufy Security', 2, NULL, 'replace', 'No usable API'),
('ADT', 2, NULL, 'fixed', 'Permanent codes — document only'),
('KK Home', 1, NULL, 'replace', 'Kaadas closed cloud'),
('XThings / Ultraloq', 1, NULL, 'api', 'Free OpenAPI from Xthings Home app — provider pending credentials'),
('Lockly', 1, NULL, 'replace', 'Paid portal only'),
('Kwikset Halo', 1, NULL, 'replace', 'No public API'),
('Yale Access', 1, NULL, 'replace', 'Partner-gated; replace with TTLock-compatible hardware'),
('Tuya / Smart Life', 1, NULL, 'replace', 'Commercial tier too expensive for one lock'),
('NGTecoHome', 1, NULL, 'fixed', 'Permanent code — document only'),
('CPI InTouch', 1, NULL, 'fixed', 'Permanent code — document only');

INSERT IGNORE INTO lock_fixed_codes (property_name, platform, code, notes, account_email) VALUES
('S Michigan', 'NGTecoHome', 'see notes', 'Fixed/standard code — not guest phone. Confirm live code with ops.', 'hotelbnbcorp@gmail.com'),
('Merion Circle', 'CPI InTouch', '2612', 'VPN required for portal; code is permanent.', 'luxurylodging'),
('Silver Springs Cir SW', 'ADT', '2025', 'Fixed code — no per-guest automation.', 'romonetaylor97@att.net'),
('Chenault', 'ADT', '264/270', 'Fixed codes 264 and 270.', 'pastorsamelijah@gmail.com'),
('Winona', 'XThings / Ultraloq', '16795', 'Backup code until Ultraloq OpenAPI is wired.', 'angelica@luxurylodgingpm.com'),
('St Louis 2E', 'KK Home', '4545', 'Back door backup code until hardware replaced.', NULL);
