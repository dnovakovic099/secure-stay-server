-- Migration: Add llCover column to expense table
-- Date: 2024-12-28

ALTER TABLE expense
ADD COLUMN llCover TINYINT(1) NOT NULL DEFAULT 0;
