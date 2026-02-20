import { appDatabase } from "../utils/database.util";
import { Listing } from "../entity/Listing";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { Hostify, HostifyCalendarDay } from "../client/Hostify";
import logger from "../utils/logger.utils";

// Default tax rate (12% is common for STR in many US markets)
const DEFAULT_TAX_RATE = 0.12;

export interface QuoteRequest {
  listingId: number;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
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
  quote?: QuoteBreakdown;
}

export class QuoteService {
  private listingRepository = appDatabase.getRepository(Listing);
  private clientPropertyRepository = appDatabase.getRepository(ClientPropertyEntity);
  private hostify = new Hostify();
  private apiKey = process.env.HOSTIFY_API_KEY || '';

  /**
   * Calculate a quote for a single listing
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
        };
      }

      // Get pet policy from ClientPropertyEntity → PropertyInfo
      const petPolicy = await this.getPetPolicy(listingId);
      const isPetFriendly = petPolicy.allowPets;

      // If pets requested but property doesn't allow, not available
      if (includePets && !isPetFriendly) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly: false,
        };
      }

      // Get calendar rates from Hostify
      const calendar = await this.hostify.getCalendar(
        this.apiKey,
        listingId,
        startDate,
        endDate
      );

      // Check availability and collect nightly rates
      const nightlyRates: { date: string; rate: number; }[] = [];
      let isAvailable = true;
      let hasAllPrices = true;

      // Calculate number of nights
      const start = new Date(startDate);
      const end = new Date(endDate);
      const numberOfNights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      // Build a map of calendar days
      const calendarMap = new Map<string, HostifyCalendarDay>();
      calendar.forEach(day => {
        calendarMap.set(day.date, day);
      });

      // Check each night (excluding checkout date)
      for (let i = 0; i < numberOfNights; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        const dayData = calendarMap.get(dateStr);

        if (!dayData) {
          // No data for this date - use base price from listing
          nightlyRates.push({
            date: dateStr,
            rate: listing.price || 0,
          });
          if (!listing.price) {
            hasAllPrices = false;
          }
        } else {
          // Check if day is blocked
          if (dayData.status && dayData.status.toLowerCase() !== 'available') {
            isAvailable = false;
          }

          nightlyRates.push({
            date: dateStr,
            rate: dayData.price || dayData.basePrice || listing.price || 0,
          });

          if (!dayData.price && !dayData.basePrice && !listing.price) {
            hasAllPrices = false;
          }
        }
      }

      if (!isAvailable) {
        return {
          listingId,
          isAvailable: false,
          isPetFriendly,
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

      const feesSubtotal = cleaningFee + petFee + extraGuestFee;
      const subtotalBeforeTax = nightlySubtotal + feesSubtotal;

      // Calculate tax
      const taxRate = DEFAULT_TAX_RATE;
      const taxAmount = Math.round(subtotalBeforeTax * taxRate * 100) / 100;

      const totalPrice = Math.round((subtotalBeforeTax + taxAmount) * 100) / 100;

      const quote: QuoteBreakdown = {
        nightlyRates,
        nightlySubtotal,
        cleaningFee,
        petFee,
        petFeeDetails,
        extraGuestFee,
        feesSubtotal,
        subtotalBeforeTax,
        taxRate,
        taxAmount,
        totalPrice,
        currency: listing.currencyCode || "USD",
        isPetFriendly,
        priceAvailable: hasAllPrices,
        unavailableReason: hasAllPrices ? undefined : "Missing nightly rates for some dates",
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
      };
    }
  }

  /**
   * Get quotes for multiple listings (batched for performance)
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
    if (maxTotalPrice !== undefined) {
      return results.filter(r => {
        if (!r.isAvailable || !r.quote) return false;
        if (!r.quote.priceAvailable) return false; // Exclude if price unavailable
        return r.quote.totalPrice <= maxTotalPrice;
      });
    }

    return results;
  }

  /**
   * Get pet policy for a listing by checking ClientPropertyEntity → PropertyInfo
   */
  private async getPetPolicy(listingId: number): Promise<{
    allowPets: boolean;
    petFee: number;
    petFeeType: string;
    numberOfPetsAllowed: number;
  }> {
    try {
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

      // Fallback: check if listing has pet fee amount (implies pets allowed)
      const listing = await this.listingRepository.findOne({
        where: { id: listingId },
        select: ['airbnbPetFeeAmount'],
      });

      return {
        allowPets: (listing?.airbnbPetFeeAmount || 0) > 0,
        petFee: listing?.airbnbPetFeeAmount || 0,
        petFeeType: "Per Stay",
        numberOfPetsAllowed: 2, // Default
      };
    } catch (error) {
      logger.error(`Error getting pet policy for listing ${listingId}:`, error);
      return {
        allowPets: false,
        petFee: 0,
        petFeeType: "Per Stay",
        numberOfPetsAllowed: 0,
      };
    }
  }

  /**
   * Check if a listing is pet-friendly
   */
  async isPetFriendly(listingId: number): Promise<boolean> {
    const policy = await this.getPetPolicy(listingId);
    return policy.allowPets;
  }

  /**
   * Get pet-friendly listing IDs from a list
   */
  async filterPetFriendlyListings(listingIds: number[]): Promise<number[]> {
    const results = await Promise.all(
      listingIds.map(async id => ({
        id,
        petFriendly: await this.isPetFriendly(id),
      }))
    );
    return results.filter(r => r.petFriendly).map(r => r.id);
  }
}
