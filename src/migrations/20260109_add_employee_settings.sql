-- Add employee settings columns to users table
ALTER TABLE users ADD COLUMN startDate DATE NULL;
ALTER TABLE users ADD COLUMN hourlyRate DECIMAL(10,2) NULL;
ALTER TABLE users ADD COLUMN dailyHourLimit DECIMAL(4,2) NULL;
ALTER TABLE users ADD COLUMN offDays VARCHAR(50) NULL;
