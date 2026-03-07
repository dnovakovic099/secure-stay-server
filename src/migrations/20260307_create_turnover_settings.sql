-- Create turnover_settings table for per-listing turnover configuration
CREATE TABLE IF NOT EXISTS turnover_settings (
    listing_id INT PRIMARY KEY,
    
    -- Pre-stay settings
    pre_stay_contact_id INT NULL,
    pre_stay_enabled BOOLEAN DEFAULT TRUE,
    
    -- Post-stay settings
    post_stay_contact_id INT NULL,
    post_stay_enabled BOOLEAN DEFAULT TRUE,
    
    -- Owner info (cached from Hostify)
    owner_name VARCHAR(255) NULL,
    owner_email VARCHAR(255) NULL,
    owner_phone VARCHAR(50) NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL
);

-- Add index on owner email for lookups
CREATE INDEX IF NOT EXISTS idx_turnover_settings_owner_email ON turnover_settings(owner_email);
