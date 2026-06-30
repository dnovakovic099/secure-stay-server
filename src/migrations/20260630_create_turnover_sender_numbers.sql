-- Dedicated table that backs the four labeled Turnover Sender Number dropdowns
-- (Cleaner Default, Cleaner Portfolio Group 1, Cleaner Portfolio Group 2, Owners).
-- Replaces the previous reliance on messaging_phone_number_info for the turnover UI.
CREATE TABLE IF NOT EXISTS turnover_sender_numbers (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(50) NOT NULL,
    country_code VARCHAR(10) NOT NULL DEFAULT '+1',
    phone VARCHAR(50) NOT NULL,
    display_name VARCHAR(150) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    updated_by VARCHAR(255) NULL,
    UNIQUE KEY uq_turnover_sender_label_phone (label, phone)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
