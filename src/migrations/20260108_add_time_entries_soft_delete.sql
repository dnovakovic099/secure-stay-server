-- Migration: Add deletedAt and deletedBy columns to time_entries for soft delete
-- Created: 2026-01-08

ALTER TABLE time_entries ADD COLUMN deletedAt DATETIME DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN deletedBy INT DEFAULT NULL;

