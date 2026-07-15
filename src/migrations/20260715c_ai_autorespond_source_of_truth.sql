ALTER TABLE `ai_messaging_settings`
    ADD COLUMN `quoAutoRespondEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `autoRespondEnabled`;

ALTER TABLE `quo_phone_lines`
    ADD COLUMN `aiAutoRespondEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `enabled`;
