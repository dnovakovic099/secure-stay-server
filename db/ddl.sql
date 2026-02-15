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

-- Data exporting was unselected.

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;

-- Thread messages table for GR Tasks Slack sync
CREATE TABLE IF NOT EXISTS `thread_message` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `gr_task_id` int(11) NOT NULL,
  `source` varchar(20) NOT NULL COMMENT 'slack or securestay',
  `user_name` varchar(255) NOT NULL,
  `user_avatar` varchar(500) DEFAULT NULL,
  `content` text NOT NULL,
  `slack_message_ts` varchar(50) DEFAULT NULL,
  `message_timestamp` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gr_task_id` (`gr_task_id`),
  KEY `idx_source` (`source`),
  KEY `idx_message_timestamp` (`message_timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
