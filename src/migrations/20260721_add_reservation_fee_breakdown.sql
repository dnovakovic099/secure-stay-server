-- Persist the Hostify per-reservation `fees` breakdown so accounting dashboards
-- (Claims Fee Funds, income reports) can read it without a live API call.
-- Requires the sync to include fees=1 & fees_costs=1. `resortFee` uses this exact
-- name so ExpenseService.getReservationClaimsFeeColumn() picks it up.
ALTER TABLE `reservation_info`
  ADD COLUMN IF NOT EXISTS `accommodationFee` FLOAT NULL,
  ADD COLUMN IF NOT EXISTS `resortFee` FLOAT NULL,
  ADD COLUMN IF NOT EXISTS `cleaningFeeAmount` FLOAT NULL,
  ADD COLUMN IF NOT EXISTS `managementCommission` FLOAT NULL,
  ADD COLUMN IF NOT EXISTS `insuranceFee` FLOAT NULL;
