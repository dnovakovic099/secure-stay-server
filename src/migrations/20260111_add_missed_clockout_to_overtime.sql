-- Migration to add isMissedClockout column to overtime_requests
ALTER TABLE overtime_requests ADD COLUMN isMissedClockout BOOLEAN DEFAULT FALSE;
