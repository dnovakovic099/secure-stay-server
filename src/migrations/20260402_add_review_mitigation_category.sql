-- Migration: Add Review Mitigation expense category
-- Date: 2026-04-02

INSERT INTO category (categoryName, hostawayId)
VALUES ('Review Mitigation', 10010);
