-- Add resolutionId column to live_issues table for linking live issues to resolutions
ALTER TABLE live_issues ADD COLUMN resolutionId INT NULL;

-- Add index for faster lookups
CREATE INDEX idx_live_issues_resolutionId ON live_issues(resolutionId);
