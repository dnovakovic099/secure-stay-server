-- One-time cleanup: the legacy *_enabled_override flags used to be auto-stamped on every
-- per-property toggle, which let properties bypass the global kill switch. The global toggle
-- is now the source of truth, so any lingering override=true rows (other than the global row
-- listing_id=0) are reset.
UPDATE turnover_settings
SET pre_stay_enabled_override = 0,
    post_stay_enabled_override = 0,
    same_day_combined_enabled_override = 0
WHERE listing_id <> 0
  AND (pre_stay_enabled_override = 1
       OR post_stay_enabled_override = 1
       OR same_day_combined_enabled_override = 1)
