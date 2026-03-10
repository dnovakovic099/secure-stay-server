-- Create hostify_users table
CREATE TABLE IF NOT EXISTS hostify_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hostifyId VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) NULL,
    first_name VARCHAR(255) NULL,
    last_name VARCHAR(255) NULL,
    phone VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    roles VARCHAR(255) NULL,
    status VARCHAR(50) DEFAULT 'active',
    timezone VARCHAR(100) NULL,
    language VARCHAR(50) NULL,
    avatar TEXT NULL,
    last_login_at DATETIME NULL,
    listing_ids JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
