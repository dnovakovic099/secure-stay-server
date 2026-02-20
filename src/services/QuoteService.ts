import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { Hostify, HostifyCalendarDay, HostifyListingFees } from "../client/Hostify";
import logger from "../utils/logger.utils";
import { In, Not, LessThan, MoreThan } from "typeorm";

/**
 * Default tax rate used ONLY when Hostify returns 0 or null.
 * Most listings should have tax configured in Hostify.
 */
const DEFAULT_TAX_RATE = 0.12;

// Cache for listing fees to avoid repeated API calls
const listingFeesCache = new Map<number, { fees: HostifyListingFees; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Valid reservation statuses (exclude cancelled/declined)
const INVALID_BOOKING_STATUSES = ["cancelled", "declined", "expired", "inquiry"];

// Calendar statuses that indicate unavailability
const UNAVAILABLE_STATUSES = ["booked", "blocked", "unavailable", "reserved", "maintenance"];

export interface QuoteRequest {
  listingId: number;
  startDate: string;  // YYYY-MM-DD (check-in date)
  endDate: string;    // YYYY-MM-DD (check-out date, NOT a night)
  guests?: number;
  includePets?: boolean;
  numberOfPets?: number;
}

export interface QuoteBreakdown {
  nightlyRates: { date: string; rate: number; }[];
  nightlySubtotal: number;
  cleaningFee: number;
  petFee: number;
  petFeeDetails?: {
    type: string;  // "Per Stay", "Per Pet", "Per Pet/Night"
    amount: number;
    numberOfPets: number;
    numberOfNights: number;
  };
  extraGuestFee: number;
  otherFees: number;  // Any other listing fees
  feesSubtotal: number;
  subtotalBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
  currency: string;
  isPetFriendly: boolean;
  priceAvailable: boolean;
  unavailableReason?: string;
}

export interface PropertyQuote {
  listingId: number;
  isAvailable: boolean;
  isPetFriendly: boolean;
  unavailableReason?: string;
  quote?: QuoteBreakdown;
}

export class QuoteService {
  private listingRepository = appDatabase.getRepository(Listing);
  private clientPropertyRepository = appDatabase.getRepository(ClientPropertyEntity);
  private reservationRepository = appDatabase.getRepository(ReservationInfoEntity);
  private hostify = new Hostify();
  private apiKey = process.env.HOSTIFY_API_KEY || '';

  /**
   * Check if a property has any booking conflicts for the date range.
   * Uses overlap logic: booking.startDate < checkOut AND booking.endDate > checkIn
   * This treats stay as [checkIn, checkOut) - checkout date is NOT a night.
   */
  async hasBookingConflict(
    listingId: number,
    checkIn: string,
    checkOut: string
  ): Promise<{ hasConflict: boolean; conflictType?: string }> {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Query: arrivalDate < checkOut AND departureDate > checkIn
    const conflictingReservations = await this.reservationRepository.count({
      where: {
        listingMapId: listingId,
        status: Not(In(INVALID_BOOKING_STATUSES)),
        arrivalDate: LessThan(checkOutDate),
        departureDate: MoreThan(checkInDate),
      },
    });

    if (conflictingReservations > 0) {
      return { hasConflict: true, conflictType: "existing_booking" };
    }

    return { hasConflict: false };
  }

  /**
   * Check if calendar has any blocked/unavailable dates in the range.
   * Checks each night from checkIn to (checkOut - 1).
   */
  async hasCalendarBlock(
    listingId: number,
    checkIn: string,
    checkOut: string,
    calendar: HostifyCalendarDay[]
  ): Promise<{ hasBlock: boolean; blockedDates: string[] }> {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const numberOfNights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

    // Build calendar map
    const calendarMap = new Map<string, HostifyCalendarDay>();
    calendar.forEach(day => {
      calendarMap.set(day.date, day);
    });

    const blockedDates: string[] = [];

    // Check each night (excluding checkout date)
    for (let i = 0; i < numberOfNights; i++) {
      const date = new Date(checkInDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const dayData = calendarMap.get(dateStr);
      if (dayData) {
        const status = (dayData.status || '').toLowerCase();
        if (UNAVAILABLE_STATUSES.some(s => status.includes(s))) {
          blockedDates.push(dateStr);
        }
      }
    }

    return {
      hasBlock: blockedDates.length > 0,
      blockedDates,
    };
  }

  /**
   * Get listing fees from Hostify with caching.
   * Returns tax rate, pet policy, cleaning fee, etc.
   */
  async getListingFees(listingId: number): Promise<HostifyListingFees | null> {
    // Check cache first
    const cached = listingFeesCache.get(listingId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return cached.fees;
    }

    try {
      const fees = await this.hostify.getListingFees(this.apiKey, listingId);
      if (fees) {
        listingFeesCache.set(listingId, { fees, timestamp: Date.now() });
      }
      return fees;
    } catch (error) {
      logger.error(`Error fetching listing fees for ${listingId}:`, error);
      return null;
    }
  }

  /**
   * Get tax rate for a property from Hostify.
   * Hostify stores tax as a percentage (e.g., 10.25 means 10.25%).
   */
  async getTaxRate(listingId: number): Promise<number> {
    try {
      const fees = await this.getListingFees(listingId);
      
      if (fees && fees.tax > 0) {
        // Hostify tax is stored as percentage (10.25 = 10.25%)
        // Convert to decimal (0.1025)
        return fees.tax / 100;
      }

      // Fallback: try PropertyInfo.tax
      const clientProperty = await this.clientPropertyRepository.findOne({
        where: { listingId: String(listingId) },
        relations: ['propertyInfo'],
      });

      if (clientProperty?.propertyInfo?.tax) {
        const taxStr = clientProperty.propertyInfo.tax.trim();
        let taxRate: number;

        if (taxStr.includes('%')) {
          taxRate = parseFloat(taxStr.replace('%', '')) / 100;
        } else {
          const parsed = parseFloat(taxStr);
          taxRate = parsed > 1 ? parsed / 100 : parsed;
        }

        if (!isNaN(taxRate) && taxRate >= 0 && taxRate <= 1) {
          return taxRate;
        }
      }
    } catch (error) {
      logger.warn(`Error getting tax rate for listing ${listingId}, using default:`, error);
    }

    return DEFAULT_TAX_RATE;
  }

  /**
   * Calculate a quote for a single listing.
   * Checks BOTH reservations table AND calendar blocks for availability.
   */
  async getQuote(request: QuoteRequest): Promise<PropertyQuote> {
    const { listingId, startDate, endDate, guests = 1, includePets = false, numberOfPets = 1 } = request;

    try {
      // Get listing data
      const listing = await this.listingRepository.findOne({
        where: { id: listingId },
      });

      if (!listing) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly: false,
          unavailableReason: "listing_not_found",
        };
      }

      // Get pet policy
      const petPolicy = await this.getPetPolicy(listingId);
      const isPetFriendly = petPolicy.allowPets;

      // If pets requested but property doesn't allow, not available
      if (includePets && !isPetFriendly) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly: false,
          unavailableReason: "pets_not_allowed",
        };
      }

      // Step 1: Check for booking conflicts in reservations table
      const bookingCheck = await this.hasBookingConflict(listingId, startDate, endDate);
      if (bookingCheck.hasConflict) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly,
          unavailableReason: bookingCheck.conflictType,
        };
      }

      // Step 2: Get calendar and check for blocks
      const calendar = await this.hostify.getCalendar(
        this.apiKey,
        listingId,
        startDate,
        endDate
      );

      const blockCheck = await this.hasCalendarBlock(listingId, startDate, endDate, calendar);
      if (blockCheck.hasBlock) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly,
          unavailableReason: `calendar_blocked:${blockCheck.blockedDates.join(',')}`,
        };
      }

      // Step 3: Calculate pricing using calendar nightly rates
      const nightlyRates: { date: string; rate: number; }[] = [];
      let hasAllPrices = true;
      let missingRateDates: string[] = [];

      const checkInDate = new Date(startDate);
      const checkOutDate = new Date(endDate);
      const numberOfNights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

      // Build calendar map
      const calendarMap = new Map<string, HostifyCalendarDay>();
      calendar.forEach(day => {
        calendarMap.set(day.date, day);
      });

      // Collect nightly rates for each night
      for (let i = 0; i < numberOfNights; i++) {
        const date = new Date(checkInDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        const dayData = calendarMap.get(dateStr);

        if (dayData && (dayData.price > 0 || dayData.basePrice > 0)) {
          nightlyRates.push({
            date: dateStr,
            rate: dayData.price || dayData.basePrice,
          });
        } else {
          // No calendar rate for this date - mark as unavailable (Option A per spec)
          hasAllPrices = false;
          missingRateDates.push(dateStr);
          // Still add with 0 rate for tracking
          nightlyRates.push({
            date: dateStr,
            rate: 0,
          });
        }
      }

      // Per spec Option A: If any night missing rate, mark price unavailable
      if (!hasAllPrices) {
        return {
          listingId,
          isAvailable: true,  // Available but price unknown
          isPetFriendly,
          quote: {
            nightlyRates,
            nightlySubtotal: 0,
            cleaningFee: 0,
            petFee: 0,
            extraGuestFee: 0,
            otherFees: 0,
            feesSubtotal: 0,
            subtotalBeforeTax: 0,
            taxRate: 0,
            taxAmount: 0,
            totalPrice: 0,
            currency: listing.currencyCode || "USD",
            isPetFriendly,
            priceAvailable: false,
            unavailableReason: `Missing rates for: ${missingRateDates.join(', ')}`,
          },
        };
      }

      // Calculate subtotals
      const nightlySubtotal = nightlyRates.reduce((sum, nr) => sum + nr.rate, 0);
      const cleaningFee = listing.cleaningFee || 0;

      // Calculate pet fee
      let petFee = 0;
      let petFeeDetails: QuoteBreakdown['petFeeDetails'] | undefined;

      if (includePets && isPetFriendly) {
        const petFeeAmount = petPolicy.petFee || listing.airbnbPetFeeAmount || 0;
        const petFeeType = petPolicy.petFeeType || "Per Stay";

        switch (petFeeType) {
          case "Per Stay":
            petFee = petFeeAmount;
            break;
          case "Per Pet":
            petFee = petFeeAmount * numberOfPets;
            break;
          case "Per Pet/Night":
            petFee = petFeeAmount * numberOfPets * numberOfNights;
            break;
          default:
            petFee = petFeeAmount;
        }

        petFeeDetails = {
          type: petFeeType,
          amount: petFeeAmount,
          numberOfPets,
          numberOfNights,
        };
      }

      // Calculate extra guest fee
      let extraGuestFee = 0;
      const guestsIncluded = listing.guestsIncluded || 1;
      if (guests > guestsIncluded && listing.priceForExtraPerson) {
        const extraGuests = guests - guestsIncluded;
        extraGuestFee = listing.priceForExtraPerson * extraGuests * numberOfNights;
      }

      // Other fees (placeholder for resort fees, linen fees, etc.)
      const otherFees = 0;

      const feesSubtotal = cleaningFee + petFee + extraGuestFee + otherFees;
      const subtotalBeforeTax = nightlySubtotal + feesSubtotal;

      // Get tax rate (property-specific or default)
      const taxRate = await this.getTaxRate(listingId);
      const taxAmount = Math.round(subtotalBeforeTax * taxRate * 100) / 100;

      const totalPrice = Math.round((subtotalBeforeTax + taxAmount) * 100) / 100;

      const quote: QuoteBreakdown = {
        nightlyRates,
        nightlySubtotal,
        cleaningFee,
        petFee,
        petFeeDetails,
        extraGuestFee,
        otherFees,
        feesSubtotal,
        subtotalBeforeTax,
        taxRate,
        taxAmount,
        totalPrice,
        currency: listing.currencyCode || "USD",
        isPetFriendly,
        priceAvailable: true,
      };

      return {
        listingId,
        isAvailable: true,
        isPetFriendly,
        quote,
      };

    } catch (error) {
      logger.error(`Error calculating quote for listing ${listingId}:`, error);
      return {
        listingId,
        isAvailable: false,
        isPetFriendly: false,
        unavailableReason: "quote_calculation_error",
      };
    }
  }

  /**
   * Get quotes for multiple listings (batched for performance).
   * Filters out unavailable properties and optionally by max total price.
   */
  async getBatchQuotes(
    listingIds: number[],
    startDate: string,
    endDate: string,
    options: {
      guests?: number;
      includePets?: boolean;
      numberOfPets?: number;
      maxTotalPrice?: number;
    } = {}
  ): Promise<PropertyQuote[]> {
    const { guests = 1, includePets = false, numberOfPets = 1, maxTotalPrice } = options;

    // Process in parallel with concurrency limit
    const concurrencyLimit = 10;
    const results: PropertyQuote[] = [];

    for (let i = 0; i < listingIds.length; i += concurrencyLimit) {
      const batch = listingIds.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(listingId =>
          this.getQuote({
            listingId,
            startDate,
            endDate,
            guests,
            includePets,
            numberOfPets,
          })
        )
      );
      results.push(...batchResults);
    }

    // Filter by max total price if specified
    // Per spec: only include if priceAvailable AND totalPrice <= maxTotalPrice
    if (maxTotalPrice !== undefined) {
      return results.filter(r => {
        // Keep unavailable properties out of price-filtered results
        if (!r.isAvailable) return false;
        if (!r.quote) return false;
        // Exclude properties where price is unavailable (Option A from spec)
        if (!r.quote.priceAvailable) return false;
        return r.quote.totalPrice <= maxTotalPrice;
      });
    }

    return results;
  }

  /**
   * Get pet policy for a listing.
   * Priority: Hostify API > PropertyInfo > Listing entity
   */
  private async getPetPolicy(listingId: number): Promise<{
    allowPets: boolean;
    petFee: number;
    petFeeType: string;
    numberOfPetsAllowed: number;
  }> {
    try {
      // First try Hostify API (most accurate, directly from PMS)
      const hostifyFees = await this.getListingFees(listingId);
      if (hostifyFees) {
        return {
          allowPets: hostifyFees.petsAllowed,
          petFee: hostifyFees.petsFee || 0,
          petFeeType: "Per Stay",  // Hostify default
          numberOfPetsAllowed: 2,  // Default if not specified
        };
      }

      // Fallback: PropertyInfo
      const clientProperty = await this.clientPropertyRepository.findOne({
        where: { listingId: String(listingId) },
        relations: ['propertyInfo'],
      });

      if (clientProperty?.propertyInfo) {
        return {
          allowPets: clientProperty.propertyInfo.allowPets || false,
          petFee: Number(clientProperty.propertyInfo.petFee) || 0,
          petFeeType: clientProperty.propertyInfo.petFeeType || "Per Stay",
          numberOfPetsAllowed: clientProperty.propertyInfo.numberOfPetsAllowed || 0,
        };
      }

      // Last fallback: check if listing has pet fee amount (implies pets allowed)
      const listing = await this.listingRepository.findOne({
        where: { id: listingId },
        select: ['airbnbPetFeeAmount'],
      });

      return {
        allowPets: (listing?.airbnbPetFeeAmount || 0) > 0,
        petFee: listing?.airbnbPetFeeAmount || 0,
        petFeeType: "Per Stay",
        numberOfPetsAllowed: 2,
      };
    } catch (error) {
      logger.error(`Error getting pet policy for listing ${listingId}:`, error);
      // Return safe default - assume no pets allowed
      return {
        allowPets: false,
        petFee: 0,
        petFeeType: "Per Stay",
        numberOfPetsAllowed: 0,
      };
    }
  }

  /**
   * Check if a listing is pet-friendly.
   * Returns false on error (safe default).
   */
  async isPetFriendly(listingId: number): Promise<boolean> {
    try {
      const policy = await this.getPetPolicy(listingId);
      return policy.allowPets;
    } catch (error) {
      logger.error(`Error checking pet-friendly status for listing ${listingId}:`, error);
      return false;  // Safe default
    }
  }

  /**
   * Get pet-friendly listing IDs from a list.
   * Non-fatal: errors are logged but don't crash the filter.
   * Returns empty array on complete failure.
   */
  async filterPetFriendlyListings(listingIds: number[]): Promise<number[]> {
    try {
      const results = await Promise.all(
        listingIds.map(async id => {
          try {
            return {
              id,
              petFriendly: await this.isPetFriendly(id),
              error: false,
            };
          } catch (error) {
            logger.warn(`Pet check failed for listing ${id}:`, error);
            return { id, petFriendly: false, error: true };
          }
        })
      );
      
      const petFriendlyIds = results.filter(r => r.petFriendly).map(r => r.id);
      const errorCount = results.filter(r => r.error).length;
      
      if (errorCount > 0) {
        logger.warn(`Pet filter: ${errorCount}/${listingIds.length} listings had errors`);
      }
      
      return petFriendlyIds;
    } catch (error) {
      logger.error('Complete failure in filterPetFriendlyListings:', error);
      return [];  // Return empty array, not throw
    }
  }

  /**
   * Safe wrapper for pet filtering that never throws.
   * Returns { success, ids, error } for graceful UI handling.
   */
  async filterPetFriendlyListingsSafe(listingIds: number[]): Promise<{
    success: boolean;
    ids: number[];
    error?: string;
  }> {
    try {
      const ids = await this.filterPetFriendlyListings(listingIds);
      return { success: true, ids };
    } catch (error: any) {
      logger.error('Pet filtering failed completely:', error);
      return {
        success: false,
        ids: listingIds,  // Return all IDs as fallback
        error: error.message || 'Pet filter failed',
      };
    }
  }
}
