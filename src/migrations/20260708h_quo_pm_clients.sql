-- PM CLIENTS: Quo conversations on PM lines are chats with property-management
-- clients (owners), not guests. Link them to client_management so the AI gets
-- owner context (their profile + properties + reservations) and can auto-respond.
ALTER TABLE `quo_conversations`
    ADD COLUMN `pmClientId` VARCHAR(36) NULL AFTER `linkMethod`,
    ADD COLUMN `pmClientName` VARCHAR(255) NULL AFTER `pmClientId`,
    ADD COLUMN `pmClientLinkMethod` VARCHAR(20) NULL AFTER `pmClientName`;

CREATE INDEX `IDX_quo_conversations_pmClientId` ON `quo_conversations` (`pmClientId`);
