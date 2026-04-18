ALTER TABLE utility_provider
ADD COLUMN IF NOT EXISTS account_name VARCHAR(255) NULL AFTER provider_name;
