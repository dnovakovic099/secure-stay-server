UPDATE upsell_info late
JOIN upsell_info early
  ON LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
 AND early.isActive = 1
SET
  late.serviceType = early.serviceType,
  late.price = early.price,
  late.timePeriod = early.timePeriod,
  late.availability = early.availability,
  late.description = early.description,
  late.internalNotes = early.internalNotes,
  late.status = early.status,
  late.image = early.image,
  late.isActive = 1,
  late.isDefault = early.isDefault,
  late.actualFee = early.actualFee,
  late.pmFee = early.pmFee,
  late.processingFee = early.processingFee
WHERE LOWER(REPLACE(late.title, '-', ' ')) = 'late check out';

INSERT INTO upsell_info (
  title,
  serviceType,
  price,
  timePeriod,
  availability,
  description,
  internalNotes,
  status,
  image,
  isActive,
  isDefault,
  actualFee,
  pmFee,
  processingFee
)
SELECT
  'Late Check-Out',
  early.serviceType,
  early.price,
  early.timePeriod,
  early.availability,
  early.description,
  early.internalNotes,
  early.status,
  early.image,
  1,
  early.isDefault,
  early.actualFee,
  early.pmFee,
  early.processingFee
FROM upsell_info early
WHERE LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
  AND early.isActive = 1
  AND NOT EXISTS (
    SELECT 1
    FROM upsell_info existing
    WHERE LOWER(REPLACE(existing.title, '-', ' ')) = 'late check out'
      AND existing.isActive = 1
  )
LIMIT 1;

UPDATE upsell_listing lateListing
JOIN upsell_info late
  ON late.upsell_id = lateListing.upSellId
 AND LOWER(REPLACE(late.title, '-', ' ')) = 'late check out'
 AND late.isActive = 1
JOIN upsell_info early
  ON LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
 AND early.isActive = 1
JOIN upsell_listing earlyListing
  ON earlyListing.upSellId = early.upsell_id
 AND earlyListing.listingId = lateListing.listingId
SET lateListing.status = earlyListing.status;

INSERT INTO upsell_listing (listingId, upSellId, status)
SELECT earlyListing.listingId, late.upsell_id, earlyListing.status
FROM upsell_info early
JOIN upsell_info late
  ON LOWER(REPLACE(late.title, '-', ' ')) = 'late check out'
 AND late.isActive = 1
JOIN upsell_listing earlyListing
  ON earlyListing.upSellId = early.upsell_id
WHERE LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
  AND early.isActive = 1
  AND NOT EXISTS (
    SELECT 1
    FROM upsell_listing existing
    WHERE existing.upSellId = late.upsell_id
      AND existing.listingId = earlyListing.listingId
  );

UPDATE upsell_property_config lateConfig
JOIN upsell_info late
  ON late.upsell_id = lateConfig.upSellId
 AND LOWER(REPLACE(late.title, '-', ' ')) = 'late check out'
 AND late.isActive = 1
JOIN upsell_info early
  ON LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
 AND early.isActive = 1
JOIN upsell_property_config earlyConfig
  ON earlyConfig.upSellId = early.upsell_id
 AND earlyConfig.listingId = lateConfig.listingId
SET
  lateConfig.serviceType = earlyConfig.serviceType,
  lateConfig.pmFee = earlyConfig.pmFee,
  lateConfig.actualFee = earlyConfig.actualFee,
  lateConfig.processingFee = earlyConfig.processingFee,
  lateConfig.chargeType = earlyConfig.chargeType,
  lateConfig.rateConfiguration = earlyConfig.rateConfiguration,
  lateConfig.pricingRules = earlyConfig.pricingRules,
  lateConfig.upsellFee = earlyConfig.upsellFee,
  lateConfig.pairSyncStatus = 'synced',
  lateConfig.internalNotes = earlyConfig.internalNotes,
  lateConfig.updatedAt = NOW();

INSERT INTO upsell_property_config (
  upSellId,
  listingId,
  serviceType,
  pmFee,
  actualFee,
  processingFee,
  chargeType,
  rateConfiguration,
  pricingRules,
  upsellFee,
  pairSyncStatus,
  internalNotes,
  createdAt,
  updatedAt
)
SELECT
  late.upsell_id,
  earlyConfig.listingId,
  earlyConfig.serviceType,
  earlyConfig.pmFee,
  earlyConfig.actualFee,
  earlyConfig.processingFee,
  earlyConfig.chargeType,
  earlyConfig.rateConfiguration,
  earlyConfig.pricingRules,
  earlyConfig.upsellFee,
  'synced',
  earlyConfig.internalNotes,
  NOW(),
  NOW()
FROM upsell_info early
JOIN upsell_info late
  ON LOWER(REPLACE(late.title, '-', ' ')) = 'late check out'
 AND late.isActive = 1
JOIN upsell_property_config earlyConfig
  ON earlyConfig.upSellId = early.upsell_id
WHERE LOWER(REPLACE(early.title, '-', ' ')) = 'early check in'
  AND early.isActive = 1
  AND NOT EXISTS (
    SELECT 1
    FROM upsell_property_config existing
    WHERE existing.upSellId = late.upsell_id
      AND existing.listingId = earlyConfig.listingId
  );
