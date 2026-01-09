-- Add isSuperAdmin column to users table
ALTER TABLE users ADD COLUMN isSuperAdmin BOOLEAN DEFAULT FALSE;
