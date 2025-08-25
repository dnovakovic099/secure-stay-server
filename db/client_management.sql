-- Create client_management table
CREATE TABLE IF NOT EXISTS `client_management` (
  `id` varchar(36) NOT NULL,
  `fullName` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL UNIQUE,
  `phone` varchar(50) NOT NULL,
  `dialCode` varchar(10) NOT NULL,
  `status` enum('Active','Inactive','Pending','Suspended') NOT NULL DEFAULT 'Active',
  `companyName` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `zipCode` varchar(20) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `clientType` enum('Individual','Corporate','Agency') NOT NULL DEFAULT 'Individual',
  `source` enum('Direct','Referral','Website','Social Media','Other') NOT NULL DEFAULT 'Direct',
  `notes` text DEFAULT NULL,
  `totalBookings` int(11) NOT NULL DEFAULT 0,
  `totalSpent` decimal(10,2) NOT NULL DEFAULT 0.00,
  `lastBookingDate` timestamp NULL DEFAULT NULL,
  `tags` text DEFAULT NULL,
  `preferences` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  `createdBy` varchar(255) NOT NULL,
  `updatedBy` varchar(255) DEFAULT NULL,
  `deletedBy` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_status` (`status`),
  KEY `idx_clientType` (`clientType`),
  KEY `idx_source` (`source`),
  KEY `idx_createdAt` (`createdAt`),
  KEY `idx_deletedAt` (`deletedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert some sample data for testing
INSERT INTO `client_management` (
  `id`, `fullName`, `email`, `phone`, `dialCode`, `status`, 
  `companyName`, `address`, `city`, `state`, `zipCode`, `country`,
  `clientType`, `source`, `notes`, `totalBookings`, `totalSpent`,
  `createdBy`
) VALUES 
(
  UUID(), 'John Doe', 'john.doe@example.com', '1234567890', '+1', 'Active',
  'Doe Enterprises', '123 Main St', 'New York', 'NY', '10001', 'USA',
  'Individual', 'Direct', 'VIP client', 5, 2500.00, 'system'
),
(
  UUID(), 'Jane Smith', 'jane.smith@example.com', '0987654321', '+1', 'Active',
  'Smith Corp', '456 Oak Ave', 'Los Angeles', 'CA', '90210', 'USA',
  'Corporate', 'Website', 'Regular business client', 12, 8500.00, 'system'
),
(
  UUID(), 'Bob Johnson', 'bob.johnson@example.com', '5551234567', '+1', 'Pending',
  NULL, '789 Pine Rd', 'Chicago', 'IL', '60601', 'USA',
  'Individual', 'Referral', 'New client referral', 0, 0.00, 'system'
),
(
  UUID(), 'Alice Brown', 'alice.brown@example.com', '4449876543', '+1', 'Inactive',
  'Brown Agency', '321 Elm St', 'Miami', 'FL', '33101', 'USA',
  'Agency', 'Social Media', 'Inactive due to relocation', 3, 1200.00, 'system'
);
