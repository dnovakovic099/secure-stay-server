-- Migration: Create city_state_info table
-- Date: 2026-02-08

CREATE TABLE IF NOT EXISTS `city_state_info` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `city` VARCHAR(255) NOT NULL,
  `state_id` VARCHAR(255) NOT NULL,
  `state_name` VARCHAR(255) NOT NULL,
  `lat` VARCHAR(255) NOT NULL,
  `lng` VARCHAR(255) NOT NULL,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Index for state_id
CREATE INDEX idx_city_state_info_state_id ON city_state_info(state_id);

-- Index for state_name
CREATE INDEX idx_city_state_info_state_name ON city_state_info(state_name);
