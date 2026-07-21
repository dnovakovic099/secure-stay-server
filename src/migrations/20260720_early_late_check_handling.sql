-- Early / late check-in & check-out handling policy for inbox AI.
-- Values: defer_to_team | deny | quote_fee_and_defer | accept_with_fee

ALTER TABLE ai_messaging_settings
  ADD COLUMN earlyCheckinHandling VARCHAR(32) NOT NULL DEFAULT 'defer_to_team';

ALTER TABLE ai_messaging_settings
  ADD COLUMN lateCheckoutHandling VARCHAR(32) NOT NULL DEFAULT 'defer_to_team';
