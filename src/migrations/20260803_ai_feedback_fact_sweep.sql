-- End-of-day Verified Facts sweep: stamp chat feedback rows once the nightly
-- job has analyzed them for property-fact proposals, so each row is only
-- sent to the extractor once.

ALTER TABLE ai_message_feedback
    ADD COLUMN IF NOT EXISTS factSweepAt DATETIME NULL,
    ADD KEY IF NOT EXISTS idx_amf_fact_sweep (factSweepAt, createdAt);
