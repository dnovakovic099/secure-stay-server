-- Migration: Smart Lock Access Code Management System
-- Date: 2024-12-30
-- Description: Creates tables for smart lock device management, property-device mapping,
--              property lock settings, and access code tracking

-- Table: smart_lock_devices
-- Stores devices fetched from lock providers (Seam, etc.)
CREATE TABLE IF NOT EXISTS smart_lock_devices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    external_device_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    connected_account_id VARCHAR(255),
    device_name VARCHAR(255),
    device_type VARCHAR(100),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    location_name VARCHAR(255),
    is_online BOOLEAN DEFAULT TRUE,
    capabilities JSON,
    provider_metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_provider_device (provider, external_device_id)
);

-- Table: property_devices
-- Maps devices to properties (many-to-many)
CREATE TABLE IF NOT EXISTS property_devices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    property_id INT NOT NULL,
    device_id INT NOT NULL,
    location_label VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES smart_lock_devices(id) ON DELETE CASCADE,
    UNIQUE KEY unique_property_device (property_id, device_id)
);

-- Table: property_lock_settings
-- Stores lock settings per property
CREATE TABLE IF NOT EXISTS property_lock_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    property_id INT NOT NULL UNIQUE,
    auto_generate_codes BOOLEAN DEFAULT FALSE,
    default_access_code VARCHAR(20),
    code_generation_mode ENUM('phone', 'random', 'default') DEFAULT 'phone',
    hours_before_checkin INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: access_codes
-- Tracks all access codes created in the system
CREATE TABLE IF NOT EXISTS access_codes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    external_code_id VARCHAR(255),
    provider VARCHAR(50) NOT NULL,
    device_id INT NOT NULL,
    property_id INT NOT NULL,
    reservation_id INT,
    guest_name VARCHAR(255),
    guest_phone VARCHAR(50),
    code VARCHAR(20) NOT NULL,
    code_name VARCHAR(255),
    status ENUM('pending', 'scheduled', 'set', 'removed', 'failed') DEFAULT 'pending',
    scheduled_at TIMESTAMP NULL,
    set_at TIMESTAMP NULL,
    provider_status VARCHAR(50),
    error_message TEXT,
    provider_metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES smart_lock_devices(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX idx_access_codes_property ON access_codes(property_id);
CREATE INDEX idx_access_codes_reservation ON access_codes(reservation_id);
CREATE INDEX idx_access_codes_status ON access_codes(status);
CREATE INDEX idx_access_codes_scheduled ON access_codes(scheduled_at);
CREATE INDEX idx_property_devices_property ON property_devices(property_id);
