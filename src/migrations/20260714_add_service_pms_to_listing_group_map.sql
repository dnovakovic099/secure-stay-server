-- Cache Hostify's `service_pms` flag on the listing_group_map so the inbox v2
-- filter can hide threads for mirror channel listings that create duplicate
-- threads for the same physical property. This map already covers every
-- listing ID we've ever seen (parents AND children), which is where the flag
-- must live — `listing_info` only holds a subset.
--
-- NULL = we haven't resolved this listing yet → treated as visible so we
-- never hide a thread we don't have enough data about.
SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `listing_group_map` ADD COLUMN `service_pms` TINYINT NULL AFTER `name`',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listing_group_map'
    AND COLUMN_NAME = 'service_pms'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
