import axios from "axios";
import { appDatabase } from "../utils/database.util";
import { CityStateInfo } from "../entity/CityStateInfo";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import logger from "../utils/logger.utils";
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Not } from "typeorm";
import { QuoteService, QuoteBreakdown } from "./QuoteService";

// Valid statuses that indicate a property is booked (not cancelled)
const INVALID_STATUSES = ["cancelled", "declined", "expired", "inquiry"];

interface SearchFilters {
  state?: string;
  city?: string;
  propertyId?: number;
  startDate?: string;
  endDate?: string;
  guests?: number;
  bedrooms?: number;       // Filter by minimum bedrooms
  bathrooms?: number;      // Filter by minimum bathrooms
  maxTotalPrice?: number;  // Filter by computed total (incl. fees & tax)
  petsIncluded?: boolean;  // Filter for pet-friendly properties
  numberOfPets?: number;   // Number of pets for fee calculation
  propertyType?: string[];
  amenities?: string[];
}

interface PricingInfo {
  totalPrice?: number;
  nightlySubtotal?: number;
  cleaningFee?: number;
  petFee?: number;
  taxAmount?: number;
  priceAvailable: boolean;
}

interface PropertyWithDistance {
  id: number;  // This is the Hostify listing ID
  internalListingName: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  guests: number;
  bedrooms?: number;
  bathrooms?: number;  // Full baths + half baths combined
  image?: string;
  isReference: boolean;
  price?: number;  // Base nightly rate (for display)
  currencyCode?: string;
  isPetFriendly?: boolean;
  pricing?: PricingInfo;  // Full computed pricing when dates provided
  propertyType?: string | null;
  amenities?: string[];
  distance?: {
    text: string;
    value: number;
  };
  duration?: {
    text: string;
    value: number;
  };
}

export interface SearchResult {
  properties: PropertyWithDistance[];
  metadata: {
    petFilterApplied: boolean;
    petFilterError?: string;
    totalFound: number;
  };
}

export class MapsService {
  private cityStateInfoRepository = appDatabase.getRepository(CityStateInfo);
  private listingRepository = appDatabase.getRepository(Listing);
  private reservationInfoRepository = appDatabase.getRepository(ReservationInfoEntity);
  private quoteService = new QuoteService();

  private normalizeAmenityName(value?: string | null): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  private normalizeAmenityFilter(value?: string | null): string | null {
    const normalized = this.normalizeAmenityName(value);
    if (!normalized) return null;
    if (normalized === "homeaway") return "vrbo";
    if (normalized.includes("hot tub")) return "hot tub";
    if (normalized.includes("pool")) return "pool";
    return normalized;
  }

  private getListingPropertyType(tags?: string | null): string | null {
    const tokens = String(tags || "")
      .split(",")
      .map((token) => token.trim());

    if (tokens.includes("Own")) return "Own";
    if (tokens.includes("Arb")) return "Arb";
    if (tokens.includes("pm") || tokens.includes("PM")) return "PM";
    return null;
  }

  /**
   * Get all unique states from city_state_info table
   */
  async getStates(): Promise<{ state_id: string; state_name: string; }[]> {
    const results = await this.cityStateInfoRepository
      .createQueryBuilder("csi")
      .select("csi.state_id", "state_id")
      .addSelect("csi.state_name", "state_name")
      .groupBy("csi.state_id")
      .addGroupBy("csi.state_name")
      .orderBy("csi.state_name", "ASC")
      .getRawMany();

    return results;
  }

  /**
   * Get cities for a given state name
   */
  async getCitiesByState(stateName: string): Promise<{ id: number; city: string; lat: string; lng: string; }[]> {
    const results = await this.cityStateInfoRepository.find({
      where: { state_name: stateName },
      select: ["id", "city", "lat", "lng"],
      order: { city: "ASC" },
    });

    return results;
  }

  /**
   * Get all listings that can serve as reference properties
   */
  async getListingsForReference(userId?: string): Promise<{ id: number; internalListingName: string; city: string; state: string; propertyType: string | null; amenities: string[]; tags: string | null; }[]> {
    const queryBuilder = this.listingRepository
      .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.listingAmenities", "listingAmenities")
      .select([
        "listing.id",
        "listing.internalListingName",
        "listing.city",
        "listing.state",
        "listing.tags",
        "listingAmenities.listing_amenity_id",
        "listingAmenities.amenityName",
      ])
      .where("listing.deletedAt IS NULL")
      .orderBy("listing.internalListingName", "ASC");

    const listings = await queryBuilder.getMany();
    return listings.map((listing) => ({
      id: listing.id,
      internalListingName: listing.internalListingName,
      city: listing.city,
      state: listing.state,
      tags: listing.tags || null,
      propertyType: this.getListingPropertyType(listing.tags),
      amenities: (listing.listingAmenities || [])
        .map((item) => item.amenityName)
        .filter((item): item is string => !!item),
    }));
  }

  /**
   * Check if a property is available for the given date range
   */
  async checkPropertyAvailability(
    listingId: number,
    startDate: string,
    endDate: string
  ): Promise<boolean> {
    // Check for overlapping reservations with valid statuses
    const overlappingReservations = await this.reservationInfoRepository.count({
      where: {
        listingMapId: listingId,
        status: Not(In(INVALID_STATUSES)),
        arrivalDate: LessThanOrEqual(new Date(endDate)),
        departureDate: MoreThanOrEqual(new Date(startDate)),
      },
    });

    return overlappingReservations === 0;
  }

  /**
   * Search for properties based on filters.
   * Returns SearchResult with properties and metadata (including pet filter status).
   */
  async searchProperties(filters: SearchFilters, userId?: string): Promise<SearchResult> {
    // Initialize metadata
    const metadata: SearchResult['metadata'] = {
      petFilterApplied: false,
      totalFound: 0,
    };

    // If no filters are provided, return an empty array (enforce strict search)
    const hasFilters = filters.state || filters.city || filters.propertyId ||
      (filters.startDate && filters.endDate) || filters.guests ||
      filters.maxTotalPrice || filters.petsIncluded ||
      (filters.propertyType && filters.propertyType.length > 0) ||
      (filters.amenities && filters.amenities.length > 0);
    if (!hasFilters) {
      return { properties: [], metadata };
    }

    const queryBuilder = this.listingRepository
      .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.images", "images")
      .where("listing.deletedAt IS NULL");

    // Apply state filter (exact match using state name)
    if (filters.state) {
      queryBuilder.andWhere("listing.state = :state", { state: filters.state });
    }

    // Apply city filter (exact match)
    if (filters.city) {
      queryBuilder.andWhere("listing.city = :city", { city: filters.city });
    }

    // Apply guest capacity filter
    if (filters.guests) {
      queryBuilder.andWhere("listing.guests >= :guests", { guests: filters.guests });
    }

    // Apply bedrooms filter
    if (filters.bedrooms) {
      queryBuilder.andWhere("listing.bedroomsNumber >= :bedrooms", { bedrooms: filters.bedrooms });
    }

    // Apply bathrooms filter (sum of full + half baths)
    if (filters.bathrooms) {
      queryBuilder.andWhere("(COALESCE(listing.bathroomsNumber, 0) + COALESCE(listing.guestBathroomsNumber, 0) * 0.5) >= :bathrooms", { bathrooms: filters.bathrooms });
    }

    if (filters.propertyType && filters.propertyType.length > 0) {
      const propertyTypeClauses: string[] = [];
      const propertyTypeParams: Record<string, string> = {};

      filters.propertyType.forEach((type, index) => {
        const normalizedType = String(type);
        const key = `propertyType${index}`;

        if (normalizedType === "PM") {
          propertyTypeClauses.push(`(listing.tags LIKE :${key} OR listing.tags LIKE :${key}Lower)`);
          propertyTypeParams[key] = "%PM%";
          propertyTypeParams[`${key}Lower`] = "%pm%";
        } else {
          propertyTypeClauses.push(`listing.tags LIKE :${key}`);
          propertyTypeParams[key] = `%${normalizedType}%`;
        }
      });

      if (propertyTypeClauses.length > 0) {
        queryBuilder.andWhere(`(${propertyTypeClauses.join(" OR ")})`, propertyTypeParams);
      }
    }

    const hasAmenityFilters = !!(filters.amenities && filters.amenities.length > 0);

    if (hasAmenityFilters) {
      // Only join amenities when we actually need to filter by them.
      // Joining another one-to-many relation into the paginated explorer query can
      // make the search path brittle and much heavier than necessary.
      queryBuilder.leftJoinAndSelect("listing.listingAmenities", "listingAmenities");
    }

    // Limit results to prevent slow queries - get max 100 listings
    queryBuilder.take(100);

    let listings = await queryBuilder.getMany();

    if (filters.amenities && filters.amenities.length > 0) {
      const requiredAmenities = filters.amenities
        .map((item) => this.normalizeAmenityFilter(item))
        .filter((item): item is string => !!item);

      if (requiredAmenities.length > 0) {
        listings = listings.filter((listing) => {
          const listingAmenities = new Set(
            (listing.listingAmenities || [])
              .map((item) => this.normalizeAmenityFilter(item.amenityName))
              .filter((item): item is string => !!item)
          );

          return requiredAmenities.every((amenity) => listingAmenities.has(amenity));
        });
      }
    }

    // If pets filter is ON, filter to only pet-friendly listings (gracefully)
    let filteredListings = listings;
    if (filters.petsIncluded) {
      const petFilterResult = await this.quoteService.filterPetFriendlyListingsSafe(
        listings.map(l => l.id)
      );

      if (petFilterResult.success) {
        filteredListings = listings.filter(l => petFilterResult.ids.includes(l.id));
        metadata.petFilterApplied = true;
      } else {
        // Pet filter failed - show all results with warning
        logger.warn('Pet filter failed, showing all results:', petFilterResult.error);
        metadata.petFilterApplied = false;
        metadata.petFilterError = petFilterResult.error || "Pet filter couldn't be applied";
        // Don't filter - show all listings
      }
    }

    // If dates are provided, we need to check availability and get quotes
    let availableListings = filteredListings;
    const quotesMap = new Map<number, PricingInfo>();

    if (filters.startDate && filters.endDate) {
      // Get quotes for all listings (includes availability check via Hostify calendar)
      const quotes = await this.quoteService.getBatchQuotes(
        filteredListings.map(l => l.id),
        filters.startDate,
        filters.endDate,
        {
          guests: filters.guests,
          includePets: filters.petsIncluded && metadata.petFilterApplied,
          numberOfPets: filters.numberOfPets || 1,
        }
      );

      // Filter to available listings and build quotes map
      const availableIds = new Set<number>();
      quotes.forEach(q => {
        if (q.isAvailable && q.quote) {
          availableIds.add(q.listingId);
          quotesMap.set(q.listingId, {
            totalPrice: q.quote.totalPrice,
            nightlySubtotal: q.quote.nightlySubtotal,
            cleaningFee: q.quote.cleaningFee,
            petFee: q.quote.petFee,
            taxAmount: q.quote.taxAmount,
            priceAvailable: q.quote.priceAvailable,
          });
        }
      });

      availableListings = filteredListings.filter(l => availableIds.has(l.id));

      // Apply max total price filter (on computed total)
      if (filters.maxTotalPrice) {
        availableListings = availableListings.filter(l => {
          const pricing = quotesMap.get(l.id);
          if (!pricing || !pricing.priceAvailable) return false;
          return (pricing.totalPrice || 0) <= filters.maxTotalPrice!;
        });
      }
    } else {
      // No dates - skip availability check and pricing
    }

    // Avoid expensive Hostify pet-policy lookups unless the user is actively filtering by pets.
    // The explorer search can already be heavy when a reference property is selected because it
    // calculates distance for the whole result set.
    const petFriendlyMap = new Map<number, boolean>();
    if (filters.petsIncluded && metadata.petFilterApplied) {
      availableListings.forEach((listing) => petFriendlyMap.set(listing.id, true));
    }

    // Transform to response format
    const properties: PropertyWithDistance[] = availableListings.map((listing) => {
      const pricing = quotesMap.get(listing.id);
      const isPetFriendly = filters.petsIncluded ? true : petFriendlyMap.get(listing.id) || false;

      // Calculate total bathrooms (full + half baths)
      const totalBathrooms = (listing.bathroomsNumber || 0) + (listing.guestBathroomsNumber || 0) * 0.5;

      return {
        id: listing.id,
        internalListingName: listing.internalListingName,
        address: listing.address,
        city: listing.city,
        state: listing.state,
        lat: listing.lat,
        lng: listing.lng,
        guests: listing.guests,
        bedrooms: listing.bedroomsNumber || undefined,
        bathrooms: totalBathrooms > 0 ? totalBathrooms : undefined,
        image: listing.images?.[0]?.url || undefined,
        isReference: filters.propertyId === listing.id,
        price: listing.price,
        currencyCode: listing.currencyCode || "USD",
        isPetFriendly,
        pricing: pricing || { priceAvailable: false },
        propertyType: this.getListingPropertyType(listing.tags),
        amenities: hasAmenityFilters
          ? (listing.listingAmenities || [])
              .map((item) => item.amenityName)
              .filter((item): item is string => !!item)
          : undefined,
      };
    });

    // If a reference property is selected, calculate distances
    if (filters.propertyId) {
      // Find the reference property (it might be in the filtered results or we might need to fetch it)
      let referenceProperty = listings.find((l) => l.id === filters.propertyId);

      if (!referenceProperty) {
        referenceProperty = await this.listingRepository.findOne({
          where: { id: filters.propertyId },
          relations: ["images", "listingAmenities"]
        }) || undefined;
      }

      if (referenceProperty) {
        // Calculate distances for all properties EXCEPT the reference property itself
        // Cast to String to handle bigint-as-string vs number comparison
        const propertiesToCalculate = properties.filter((p) => String(p.id) !== String(filters.propertyId));
        const propertiesWithDistance = await this.calculateDistances(
          referenceProperty,
          propertiesToCalculate
        );

        // Get pricing for reference property if dates provided
        let refPricing: PricingInfo | undefined;
        let refPetFriendly = false;

        if (filters.startDate && filters.endDate) {
          try {
            const refQuote = await this.quoteService.getQuote({
              listingId: referenceProperty.id,
              startDate: filters.startDate,
              endDate: filters.endDate,
              guests: filters.guests,
              includePets: filters.petsIncluded,
              numberOfPets: filters.numberOfPets || 1,
            });

            if (refQuote.quote) {
              refPricing = {
                totalPrice: refQuote.quote.totalPrice,
                nightlySubtotal: refQuote.quote.nightlySubtotal,
                cleaningFee: refQuote.quote.cleaningFee,
                petFee: refQuote.quote.petFee,
                taxAmount: refQuote.quote.taxAmount,
                priceAvailable: refQuote.quote.priceAvailable,
              };
            }
            refPetFriendly = refQuote.isPetFriendly;
          } catch (error) {
            logger.warn("Failed to fetch quote for reference property, continuing without quote", error);
            refPricing = { priceAvailable: false };
            refPetFriendly = false;
          }
        } else if (filters.petsIncluded) {
          try {
            refPetFriendly = await this.quoteService.isPetFriendly(referenceProperty.id);
          } catch (error) {
            logger.warn("Failed to fetch pet-friendly status for reference property", error);
            refPetFriendly = false;
          }
        }

        // Calculate total bathrooms for reference property
        const refTotalBathrooms = (referenceProperty.bathroomsNumber || 0) +
          (referenceProperty.guestBathroomsNumber || 0) * 0.5;

        // Prepare the reference property in response format
        const refProp: PropertyWithDistance = {
          id: referenceProperty.id,
          internalListingName: referenceProperty.internalListingName,
          address: referenceProperty.address,
          city: referenceProperty.city,
          state: referenceProperty.state,
          lat: referenceProperty.lat,
          lng: referenceProperty.lng,
          guests: referenceProperty.guests,
          bedrooms: referenceProperty.bedroomsNumber || undefined,
          bathrooms: refTotalBathrooms > 0 ? refTotalBathrooms : undefined,
          image: referenceProperty.images?.[0]?.url || undefined,
          isReference: true,
          price: referenceProperty.price,
          currencyCode: referenceProperty.currencyCode || "USD",
          isPetFriendly: refPetFriendly,
          pricing: refPricing || { priceAvailable: false },
          propertyType: this.getListingPropertyType(referenceProperty.tags),
          amenities: (referenceProperty.listingAmenities || [])
            .map((item) => item.amenityName)
            .filter((item): item is string => !!item),
        };

        // If the reference property itself matches the search criteria, put it at the top
        // Use a unique set to double-check no duplicates by ID
        const finalResults = [refProp, ...propertiesWithDistance];
        const uniquePIDs = new Set();
        const dedupedResults = finalResults.filter(p => {
          if (uniquePIDs.has(p.id)) return false;
          uniquePIDs.add(p.id);
          return true;
        });

        metadata.totalFound = dedupedResults.length;
        return { properties: dedupedResults, metadata };
      }
    }

    metadata.totalFound = properties.length;
    return { properties, metadata };
  }

  /**
   * Calculate distances from reference property to other properties using Google Distance Matrix API
   */
  async calculateDistances(
    referenceProperty: Listing,
    properties: PropertyWithDistance[]
  ): Promise<PropertyWithDistance[]> {
    if (properties.length === 0) return properties;

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      logger.warn("GOOGLE_API_KEY not configured, returning properties without distance info");
      return properties;
    }

    try {
      // Build destinations string (max 25 destinations per request)
      const batchSize = 25;
      const results: PropertyWithDistance[] = [];

      for (let i = 0; i < properties.length; i += batchSize) {
        const batch = properties.slice(i, i + batchSize);
        const destinations = batch
          .map((p) => `${p.lat},${p.lng}`)
          .join("|");

        const origin = `${referenceProperty.lat},${referenceProperty.lng}`;

        const response = await axios.get(
          `https://maps.googleapis.com/maps/api/distancematrix/json`,
          {
            params: {
              origins: origin,
              destinations: destinations,
              units: "imperial",
              key: apiKey,
            },
          }
        );

        if (response.data.status === "OK" && response.data.rows?.[0]?.elements) {
          const elements = response.data.rows[0].elements;

          batch.forEach((property, index) => {
            const element = elements[index];
            if (element.status === "OK") {
              results.push({
                ...property,
                distance: element.distance,
                duration: element.duration,
              });
            } else {
              results.push(property);
            }
          });
        } else {
          logger.warn("Distance Matrix API returned non-OK status:", response.data.status);
          results.push(...batch);
        }
      }

      // Sort by distance
      return results.sort((a, b) => {
        if (!a.distance?.value) return 1;
        if (!b.distance?.value) return -1;
        return a.distance.value - b.distance.value;
      });
    } catch (error) {
      logger.error("Error calculating distances:", error);
      return properties;
    }
  }

  /**
   * Get distance between two properties
   */
  async getDistanceBetweenProperties(
    propertyId1: number,
    propertyId2: number
  ): Promise<{ distance?: { text: string; value: number; }; duration?: { text: string; value: number; }; } | null> {
    const [property1, property2] = await Promise.all([
      this.listingRepository.findOne({ where: { id: propertyId1 } }),
      this.listingRepository.findOne({ where: { id: propertyId2 } }),
    ]);

    if (!property1 || !property2) {
      return null;
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      logger.warn("GOOGLE_API_KEY not configured");
      return null;
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/distancematrix/json`,
        {
          params: {
            origins: `${property1.lat},${property1.lng}`,
            destinations: `${property2.lat},${property2.lng}`,
            units: "imperial",
            key: apiKey,
          },
        }
      );

      if (response.data.status === "OK" && response.data.rows?.[0]?.elements?.[0]?.status === "OK") {
        const element = response.data.rows[0].elements[0];
        return {
          distance: element.distance,
          duration: element.duration,
        };
      }

      return null;
    } catch (error) {
      logger.error("Error getting distance between properties:", error);
      return null;
    }
  }
}
