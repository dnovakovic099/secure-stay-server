-- Add Slack threading fields to review_checkout for #resolutions-team integration
ALTER TABLE review_checkout ADD COLUMN slackThreadTs VARCHAR(50) NULL;
ALTER TABLE review_checkout ADD COLUMN slackChannelId VARCHAR(100) NULL;

-- Add Slack sync tracking fields to review_checkout_updates
ALTER TABLE review_checkout_updates ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'app';
ALTER TABLE review_checkout_updates ADD COLUMN slackMessageTs VARCHAR(50) NULL;
