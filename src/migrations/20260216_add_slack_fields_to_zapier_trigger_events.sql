ALTER TABLE zapier_trigger_events
  ADD COLUMN slack_channel_id VARCHAR(50) NULL,
  ADD COLUMN slack_thread_ts VARCHAR(50) NULL,
  ADD COLUMN slack_permalink VARCHAR(500) NULL;
