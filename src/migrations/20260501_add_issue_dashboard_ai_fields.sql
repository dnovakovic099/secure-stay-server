ALTER TABLE issues
  ADD COLUMN ai_short_title TEXT NULL,
  ADD COLUMN ai_checklist TEXT NULL,
  ADD COLUMN manager_feedback TEXT NULL,
  ADD COLUMN preventable_flag TINYINT(1) NULL;
