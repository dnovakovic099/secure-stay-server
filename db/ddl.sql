-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Server version:               11.4.0-MariaDB - mariadb.org binary distribution
-- Server OS:                    Win64
-- HeidiSQL Version:             12.3.0.6589
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


-- Dumping database structure for boarding-pass
CREATE DATABASE IF NOT EXISTS `boarding-pass` /*!40100 DEFAULT CHARACTER SET latin1 COLLATE latin1_swedish_ci */;
USE `boarding-pass`;

-- Dumping structure for table boarding-pass.checkin
CREATE TABLE IF NOT EXISTS `checkin` (
  `stepOrder` int(11) NOT NULL,
  `pin` int(11) DEFAULT NULL,
  `doesHavePin` tinyint(4) NOT NULL,
  `listing_id` int(11) DEFAULT NULL,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `description` text NOT NULL,
  `image` varchar(255) NOT NULL,
  `pinAdditionalInfo` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.faq
CREATE TABLE IF NOT EXISTS `faq` (
  `listing_id` int(11) DEFAULT NULL,
  `faq_id` int(11) NOT NULL AUTO_INCREMENT,
  `faq_question` varchar(255) DEFAULT NULL,
  `faq_answer` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`faq_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.item
CREATE TABLE IF NOT EXISTS `item` (
  `item_description` varchar(255) DEFAULT NULL,
  `item_id` int(11) NOT NULL AUTO_INCREMENT,
  `item_name` varchar(255) DEFAULT NULL,
  `item_price` int(11) DEFAULT NULL,
  `listing_id` int(11) DEFAULT NULL,
  `currency` varchar(255) DEFAULT NULL,
  `photo_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`item_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.payment
CREATE TABLE IF NOT EXISTS `payment` (
  `value` int(11) DEFAULT NULL,
  `currency` varchar(50) DEFAULT NULL,
  `paymentDate` date DEFAULT NULL,
  `payment_id` int(11) NOT NULL AUTO_INCREMENT,
  `reservation_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  KEY `FK_fc0069dbffe962f7b1604c14104` (`reservation_id`),
  CONSTRAINT `FK_fc0069dbffe962f7b1604c14104` FOREIGN KEY (`reservation_id`) REFERENCES `reservation` (`reservation_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.reservation
CREATE TABLE IF NOT EXISTS `reservation` (
  `reservation_id` int(11) NOT NULL AUTO_INCREMENT,
  `reservation_info_fk` int(11) DEFAULT NULL,
  `user_verification_fk` int(11) DEFAULT NULL,
  `reservationLink` varchar(50) DEFAULT NULL,
  `checkedIn` int(11) DEFAULT NULL,
  PRIMARY KEY (`reservation_id`),
  KEY `FK_350d0dea780ad3531d818b2749a` (`reservation_info_fk`),
  KEY `FK_706f9cd20fb260f4e81f9f8526f` (`user_verification_fk`),
  CONSTRAINT `FK_350d0dea780ad3531d818b2749a` FOREIGN KEY (`reservation_info_fk`) REFERENCES `reservation_info` (`reservations_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `FK_706f9cd20fb260f4e81f9f8526f` FOREIGN KEY (`user_verification_fk`) REFERENCES `user_verification` (`user_verification_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.reservation_info
CREATE TABLE IF NOT EXISTS `reservation_info` (
  `source` varchar(50) DEFAULT NULL,
  `adults` int(11) DEFAULT NULL,
  `children` int(11) DEFAULT NULL,
  `infants` int(11) DEFAULT NULL,
  `pets` int(11) DEFAULT NULL,
  `nights` int(11) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `currency` varchar(3) DEFAULT NULL,
  `comment` text DEFAULT NULL,
  `listingMapId` int(11) DEFAULT NULL,
  `channelId` int(11) DEFAULT NULL,
  `channelName` varchar(50) DEFAULT NULL,
  `reservationId` varchar(50) DEFAULT NULL,
  `hostawayReservationId` int(11) DEFAULT NULL,
  `channelReservationId` varchar(50) DEFAULT NULL,
  `externalRatePlanId` int(11) DEFAULT NULL,
  `externalUnitId` int(11) DEFAULT NULL,
  `assigneeUserId` int(11) DEFAULT NULL,
  `manualIcalId` int(11) DEFAULT NULL,
  `manualIcalName` varchar(50) DEFAULT NULL,
  `isProcessed` tinyint(4) DEFAULT NULL,
  `isInitial` tinyint(4) DEFAULT NULL,
  `isManuallyChecked` tinyint(4) DEFAULT NULL,
  `isInstantBooked` tinyint(4) DEFAULT NULL,
  `hasPullError` tinyint(4) DEFAULT NULL,
  `reservationDate` datetime DEFAULT NULL,
  `pendingExpireDate` datetime DEFAULT NULL,
  `guestFirstName` varchar(50) DEFAULT NULL,
  `guestLastName` varchar(50) DEFAULT NULL,
  `guestExternalAccountId` varchar(20) DEFAULT NULL,
  `guestZipCode` varchar(20) DEFAULT NULL,
  `guestCity` varchar(50) DEFAULT NULL,
  `guestCountry` varchar(50) DEFAULT NULL,
  `guestRecommendations` int(11) DEFAULT NULL,
  `guestTrips` int(11) DEFAULT NULL,
  `isGuestIdentityVerified` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByEmail` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByWorkEmail` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByFacebook` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByGovernmentId` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByPhone` tinyint(4) DEFAULT NULL,
  `isGuestVerifiedByReviews` tinyint(4) DEFAULT NULL,
  `numberOfGuests` int(11) DEFAULT NULL,
  `arrivalDate` date DEFAULT NULL,
  `departureDate` date DEFAULT NULL,
  `isDatesUnspecified` tinyint(4) DEFAULT NULL,
  `previousArrivalDate` date DEFAULT NULL,
  `previousDepartureDate` date DEFAULT NULL,
  `checkInTime` time DEFAULT NULL,
  `checkOutTime` time DEFAULT NULL,
  `totalPrice` decimal(10,2) DEFAULT NULL,
  `taxAmount` decimal(10,2) DEFAULT NULL,
  `channelCommissionAmount` decimal(10,2) DEFAULT NULL,
  `hostawayCommissionAmount` decimal(10,2) DEFAULT NULL,
  `cleaningFee` decimal(10,2) DEFAULT NULL,
  `securityDepositFee` decimal(10,2) DEFAULT NULL,
  `isPaid` tinyint(4) DEFAULT NULL,
  `paymentMethod` varchar(50) DEFAULT NULL,
  `stripeGuestId` varchar(50) DEFAULT NULL,
  `cancellationDate` datetime DEFAULT NULL,
  `cancelledBy` int(11) DEFAULT NULL,
  `hostNote` text DEFAULT NULL,
  `guestNote` text DEFAULT NULL,
  `guestLocale` varchar(10) DEFAULT NULL,
  `doorCode` varchar(10) DEFAULT NULL,
  `doorCodeVendor` varchar(50) DEFAULT NULL,
  `doorCodeInstruction` text DEFAULT NULL,
  `confirmationCode` varchar(20) DEFAULT NULL,
  `airbnbExpectedPayoutAmount` decimal(10,2) DEFAULT NULL,
  `airbnbListingBasePrice` decimal(10,2) DEFAULT NULL,
  `airbnbListingCancellationHostFee` decimal(10,2) DEFAULT NULL,
  `airbnbListingCancellationPayout` decimal(10,2) DEFAULT NULL,
  `airbnbListingCleaningFee` decimal(10,2) DEFAULT NULL,
  `airbnbListingHostFee` decimal(10,2) DEFAULT NULL,
  `airbnbListingSecurityPrice` decimal(10,2) DEFAULT NULL,
  `airbnbOccupancyTaxAmountPaidToHost` decimal(10,2) DEFAULT NULL,
  `airbnbTotalPaidAmount` decimal(10,2) DEFAULT NULL,
  `airbnbTransientOccupancyTaxPaidAmount` decimal(10,2) DEFAULT NULL,
  `airbnbCancellationPolicy` varchar(50) DEFAULT NULL,
  `isStarred` tinyint(4) DEFAULT NULL,
  `isArchived` tinyint(4) DEFAULT NULL,
  `isPinned` tinyint(4) DEFAULT NULL,
  `originalChannel` varchar(50) DEFAULT NULL,
  `customerUserId` int(11) DEFAULT NULL,
  `rentalAgreementFileUrl` varchar(255) DEFAULT NULL,
  `reservationAgreement` varchar(50) DEFAULT NULL,
  `remainingBalance` decimal(10,2) DEFAULT NULL,
  `reservations_id` int(11) NOT NULL AUTO_INCREMENT,
  `guestName` varchar(100) DEFAULT NULL,
  `guestAddress` varchar(255) DEFAULT NULL,
  `guestEmail` varchar(100) DEFAULT NULL,
  `guestWork` varchar(100) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `externalPropertyId` int(11) DEFAULT NULL,
  `guestPicture` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`reservations_id`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Data exporting was unselected.

-- Dumping structure for table boarding-pass.user_verification
CREATE TABLE IF NOT EXISTS `user_verification` (
  `user_verification_id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(50) DEFAULT NULL,
  `approved` int(11) NOT NULL DEFAULT 0,
  `firstName` varchar(50) DEFAULT NULL,
  `lastName` varchar(50) DEFAULT NULL,
  `photo` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_verification_id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- Dumping structure for table users
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(50) NOT NULL AUTO_INCREMENT,
  `uid` varchar(50) NOT NULL,
  `firstName` varchar(50) DEFAULT NULL,
  `lastName` varchar(50) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `companyName` varchar(100) DEFAULT NULL,
  `numberofProperties` varchar(50) DEFAULT NULL,
  `message` varchar(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `listing_info` (
  `listing_id` int NOT NULL AUTO_INCREMENT,
  `id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` TEXT NOT NULL,
  `propertyType` varchar(50) DEFAULT '',
  `externalListingName` varchar(255) NOT NULL,
  `address` varchar(255) NOT NULL,
  `guests` int(50),
  `price` float NOT NULL,
  `guestsIncluded` int NOT NULL,
  `priceForExtraPerson` float NOT NULL,
  `currencyCode` varchar(255) NOT NULL,
  `internalListingName` varchar(50) DEFAULT NULL,
  `country` varchar(50) DEFAULT NULL,
  `countryCode` varchar(50) DEFAULT NULL,
  `state` varchar(50) DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `street` varchar(100) DEFAULT NULL,
  `zipcode` varchar(50) DEFAULT NULL,
  `lat` float DEFAULT NULL,
  `lng` float DEFAULT NULL,
  `checkInTimeStart` int DEFAULT NULL,
  `checkInTimeEnd` int DEFAULT NULL,
  `checkOutTime` int DEFAULT NULL,
  `wifiUsername` varchar(50) DEFAULT NULL,
  `wifiPassword` varchar(50) DEFAULT NULL,
  `bookingcomPropertyRoomName` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`listing_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `listing_image` (
  `id` int NOT NULL AUTO_INCREMENT,
  `caption` varchar(255) DEFAULT NULL,
  `vrboCaption` varchar(255) DEFAULT NULL,
  `airbnbCaption` varchar(255) DEFAULT NULL,
  `url` varchar(255) NOT NULL,
  `sortOrder` int DEFAULT NULL,
  `listing_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `FK_9d46296bf4cb8bc590f5e6f5ade` (`listing_id`),
  CONSTRAINT `FK_9d46296bf4cb8bc590f5e6f5ade` FOREIGN KEY (`listing_id`) REFERENCES `listing_info` (`listing_id`)
) ENGINE=InnoDB AUTO_INCREMENT=532 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `listing_lock_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `listing_id` int NOT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `lock_id` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `upsell_info` (
  `upsell_id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(50) NOT NULL,
  `price` bigint NOT NULL,
  `timePeriod` varchar(50) DEFAULT 'Per Booking - Onetime',
  `description` varchar(500) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `isActive` tinyint NOT NULL DEFAULT '1',
  `availability` varchar(50) DEFAULT 'Always',
  `image` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`upsell_id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `upsell_listing` (
  `id` int NOT NULL AUTO_INCREMENT,
  `listingId` int NOT NULL,
  `upSellId` int NOT NULL,
  `status` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `users_info` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `fullName` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `contact` bigint DEFAULT NULL,
  `userType` varchar(50) NOT NULL,
  `image` varchar(200) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `isActive` tinyint NOT NULL DEFAULT '1',
  `dialCode` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `guidebook` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `listing_id` INT NOT NULL,
  `photo` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
    KEY `FK_9d46296bf4cb8bc590f5e6f5ade` (`listing_id`),
  CONSTRAINT `FK_9d46296bf4cb8bc590f5e6f5ade` FOREIGN KEY (`listing_id`) REFERENCES `listing_info` (`listing_id`) ON DELETE CASCADE
);

CREATE TABLE `sifely_lock_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `lockId` int NOT NULL,
  `lockName` varchar(255) NOT NULL,
  `lockAlias` varchar(255) NOT NULL,
  `lockMac` varchar(255) NOT NULL,
  `electricQuantity` int NOT NULL,
  `featureValue` varchar(255) NOT NULL,
  `hasGateway` int NOT NULL,
  `groupId` int DEFAULT NULL,
  `groupName` varchar(255) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `lockData` text NOT NULL,
  `date` bigint NOT NULL,
  `accessToken` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE AutomatedMessage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    messageType VARCHAR(255) NOT NULL,
    smsMessage TEXT NOT NULL,
    emailMessage TEXT NOT NULL,
    airBnbMessage TEXT NOT NULL
);


CREATE TABLE `messaging_email_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `messaging_phone_number_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `country_code` varchar(255) NOT NULL,
  `phone` varchar(255) NOT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `supportsSMS` tinyint NOT NULL DEFAULT '0',
  `supportsCalling` tinyint NOT NULL DEFAULT '0',
  `supportsWhatsApp` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE `connected_account_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account` varchar(255) NOT NULL,
  `clientId` varchar(255) DEFAULT NULL,
  `clientSecret` varchar(255) DEFAULT NULL,
  `apiKey` varchar(255) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE IF NOT EXISTS `mobileUsers` (
  `id` int(50) NOT NULL AUTO_INCREMENT,
  `hostawayId` int(50) NOT NULL,
  `firstName` varchar(50) NOT NULL,
  `lastName` varchar(50) DEFAULT NULL,
  `email` varchar(100)  NOT NULL,
  `password` varchar(100) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

CREATE TABLE IF NOT EXISTS `clients` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `leadStatus` VARCHAR(255),
    `propertyAddress` VARCHAR(255),
    `city` VARCHAR(255),
    `state` VARCHAR(255),
    `country` VARCHAR(255),
    `ownerName` VARCHAR(255),
    `salesCloser` VARCHAR(255),
    `airDnaRevenue` DECIMAL(10, 2),
    `commissionAmount` DECIMAL(10, 2),
    `commissionStatus` VARCHAR(255),
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deletedAt` TIMESTAMP NULL,
    `previewDocumentLink` VARCHAR(255) NULL,
    `beds` INT,
    `baths` INT,
    `guests` INT
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clientListings`(
 `id` INT AUTO_INCREMENT PRIMARY KEY,
 `clientId` INT,
 `airdnaMarketName` VARCHAR(255)
 `marketType` VARCHAR(50),       
 `marketScore` DECIMAL(10, 2), 
 `lat` DECIMAL(10, 7),
 `lng` DECIMAL(10, 7),
 `occupancy` DECIMAL(3, 2),
 `address` VARCHAR(255),
 `cleaningFee` DECIMAL(10, 7),
 `revenue` INT,
 `totalComps` INT,
 `comps` JSON,
 `forSalePropertyComps` JSON,
 `compsetAmenities` JSON,
 `zipcode` VARCHAR(20),
 `revenueRange` JSON
 `screenshotSessionId` VARCHAR(255),
 `propertyScreenshotSessionId` VARCHAR(255) NULL,
 `vrboPropertyId` VARCHAR(50) NULL,
 `airBnbPropertyId` VARCHAR(50) NULL,
 `metrics` JSON NULL,
 `details` JSON NULL,           
 `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data exporting was unselected.

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
