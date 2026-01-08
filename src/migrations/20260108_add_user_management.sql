-- Add user management fields to users table
ALTER TABLE users ADD COLUMN isActive BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN authProvider VARCHAR(50) DEFAULT NULL;
ALTER TABLE users ADD COLUMN userType VARCHAR(50) DEFAULT 'regular';
ALTER TABLE users ADD COLUMN lastLoginAt DATETIME DEFAULT NULL;
ALTER TABLE users ADD COLUMN disabledBy VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN disabledAt DATETIME DEFAULT NULL;
ALTER TABLE users ADD COLUMN reactivatedBy VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD COLUMN reactivatedAt DATETIME DEFAULT NULL;

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deletedAt DATETIME DEFAULT NULL,
    createdBy VARCHAR(255) DEFAULT NULL,
    updatedBy VARCHAR(255) DEFAULT NULL,
    deletedBy VARCHAR(255) DEFAULT NULL
);

-- Create user_departments junction table
CREATE TABLE IF NOT EXISTS user_departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    departmentId INT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    createdBy VARCHAR(255) DEFAULT NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_department (userId, departmentId)
);

-- Set default values for existing users
UPDATE users SET isActive = TRUE WHERE isActive IS NULL;
UPDATE users SET userType = 'regular' WHERE userType IS NULL OR userType = '';
