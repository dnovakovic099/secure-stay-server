-- Learning prompts now also come from the Quo SMS inbox. threadId alone is
-- ambiguous (quo_conversations.id can collide with Hostify thread ids), so
-- prompts carry their source inbox.
ALTER TABLE `ai_learning_prompts`
    ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'hostify' AFTER `threadId`;

CREATE INDEX `IDX_ai_learning_prompts_source_thread`
    ON `ai_learning_prompts` (`source`, `threadId`);
