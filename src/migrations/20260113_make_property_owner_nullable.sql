-- Migration to make property_owner nullable with default value
-- This allows creating upsell orders without property_owner field

ALTER TABLE upsell_orders 
MODIFY COLUMN property_owner VARCHAR(255) NULL DEFAULT '';
