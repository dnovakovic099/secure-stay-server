-- Track WHICH user taught the AI a fact (learning-prompt answer, analytics
-- "teach" box, sandbox teach). NULL for facts auto-extracted by the nightly audit.
ALTER TABLE ai_learned_facts
    ADD COLUMN createdByUserId INT NULL AFTER reviewedByUserId;
