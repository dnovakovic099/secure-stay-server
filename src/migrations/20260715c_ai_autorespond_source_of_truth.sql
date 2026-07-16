ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `quoAutoRespondEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `autoRespondEnabled`;

ALTER TABLE `quo_phone_lines`
    ADD COLUMN IF NOT EXISTS `aiAutoRespondEnabled` TINYINT NOT NULL DEFAULT 0 AFTER `enabled`;
