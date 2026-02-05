-- Migration: Add Special Cleaning and Other Supplies expense categories
-- Date: 2026-02-05

INSERT INTO category (categoryName, hostawayId)
VALUES 
    ('Special Cleaning', 10008),
    ('Other Supplies', 10009);
