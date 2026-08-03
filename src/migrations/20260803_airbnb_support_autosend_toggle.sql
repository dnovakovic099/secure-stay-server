-- Airbnb Support auto-respond opt-out: lets the team disable AI auto-sends on
-- Airbnb Support (case worker) threads while keeping guest auto-respond on.
-- Defaults to 1 (enabled) so existing behavior is unchanged at rollout.
ALTER TABLE `ai_messaging_settings`
    ADD COLUMN IF NOT EXISTS `airbnbSupportAutoRespondEnabled` TINYINT NOT NULL DEFAULT 1 AFTER `inquiryAutoRespondEnabled`;
