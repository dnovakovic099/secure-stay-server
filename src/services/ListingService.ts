import { Brackets, EntityManager, In, Not } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { Listing } from "../entity/Listing";
import { ListingChangeLog } from "../entity/ListingChangeLog";
import { ListingImage } from "../entity/ListingImage";
import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ListingLockInfo } from "../entity/ListingLock";
import { ConnectedAccountInfo } from "../entity/ConnectedAccountInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ListingScore } from "../entity/ListingScore";
import { ListingUpdateEntity } from "../entity/ListingUpdate";
import { ownerDetails, tagIds } from "../constant";
import { ListingDetail } from "../entity/ListingDetails";

import logger from "../utils/logger.utils";
import { ListingBedTypes } from "../entity/ListingBedTypes";
import { ListingAmenities } from "../entity/ListingAmenities";
import { Hostify } from "../client/Hostify";


interface ListingUpdate {
  listingId: number;
  date: string;
  action: string;
}

export class ListingService {
  private hostAwayClient = new HostAwayClient();
  private listingRepository = appDatabase.getRepository(Listing);
  private listingLockRepository = appDatabase.getRepository(ListingLockInfo);
  private connectedAccountInfoRepository = appDatabase.getRepository(ConnectedAccountInfo);
  private listingScore = appDatabase.getRepository(ListingScore)
  private listingUpdateRepo = appDatabase.getRepository(ListingUpdateEntity);
  private listingDetailRepo = appDatabase.getRepository(ListingDetail);

  private hostifyClient = new Hostify();
  private listingChangeLogRepo = appDatabase.getRepository(ListingChangeLog);

  // Fetch listings from hostaway client and save in our database if not present
  // async syncHostawayListing(userId: string) {
  //   const hostawayCredentials = await this.connectedAccountInfoRepository.findOne({
  //     where: { userId, account: "pm", status: true },
  //   });

  //   if (!hostawayCredentials) {
  //     throw CustomErrorHandler.notFound('Hostaway credentials not found');
  //   }

  //   const { clientId, clientSecret } = hostawayCredentials;
  //   const listings = await this.hostAwayClient.getListing(clientId, clientSecret);

  //   try {
  //     await appDatabase.manager.transaction(async (transactionalEntityManager) => {
  //       // Step 1: Fetch all listings for user and delete them (cascade deletes images too)
  //       const existingUserListings = await transactionalEntityManager.find(Listing, {
  //         where: { userId },
  //       });

  //       if (existingUserListings.length > 0) {
  //         const userListingIds = existingUserListings.map(l => l.listingId);
  //         await transactionalEntityManager.delete(Listing, { listingId: In(userListingIds) });
  //       }

  //       // Step 2: Insert fresh listings from Hostaway
  //       for (const listing of listings) {
  //         const listingObj = this.createListingObject(listing, userId);
  //         const savedListing = await transactionalEntityManager.save(Listing, listingObj);

  //         await this.saveListingImages(
  //           transactionalEntityManager,
  //           listing["listingImages"],
  //           savedListing.listingId
  //         );

  //         await this.saveListingTags(
  //           transactionalEntityManager,
  //           listing["listingTags"],
  //           savedListing.listingId
  //         )

  //         await this.saveListingBedTypes(
  //           transactionalEntityManager,
  //           listing["listingBedTypes"],
  //           savedListing.listingId
  //         );


  //         await this.saveListingAmenities(
  //           transactionalEntityManager,
  //           listing["listingAmenities"],
  //           savedListing.listingId
  //         )
  //       }
  //     });

  //     return 1;
  //   } catch (error) {
  //     logger.error("Error syncing listings:", error);
  //     throw error;
  //   }
  // }


  // Create a listing object from hostaway client data
  private createListingObject(data: any, userId: string) {
    return {
      id: data?.id,
      name: data?.name,
      description: data?.description,
      externalListingName: data?.externalListingName,
      address: data?.address,
      personCapacity: data?.personCapacity,
      guests: data?.personCapacity,
      price: data?.price,
      guestsIncluded: data?.guestsIncluded,
      priceForExtraPerson: data?.priceForExtraPerson,
      currencyCode: data?.currencyCode,
      internalListingName: data?.internalListingName || "",
      country: data?.country || "",
      countryCode: data?.countryCode || "",
      state: data?.state || "",
      city: data?.city || "",
      street: data?.street || "",
      zipcode: data?.zipcode || "",
      lat: data?.lat || 0,
      lng: data?.lng || 0,
      propertyType: data?.bookingcomPropertyRoomName || "",
      checkInTimeStart: data?.checkInTimeStart || 0,
      checkInTimeEnd: data?.checkInTimeEnd || 0,
      checkOutTime: data?.checkOutTime || 0,
      wifiUsername: data?.wifiUsername || "(NO WIFI)",
      wifiPassword: data?.wifiPassword || "(NO PASSWORD)",
      bookingcomPropertyRoomName: data?.bookingcomPropertyRoomName || "",
      userId: userId,
      ownerName: ownerDetails[data.id]?.name || "",
      ownerEmail: ownerDetails[data.id]?.email || "",
      ownerPhone: ownerDetails[data.id]?.phone || "",
      propertyTypeId: data?.propertyTypeId || null,
      roomType: data?.roomType || "",
      bedroomsNumber: data?.bedroomsNumber || 0,
      bathroomsNumber: data?.bathroomsNumber || 0,
      bathroomType: data?.bathroomType || "",
      guestBathroomsNumber: data?.guestBathroomsNumber || 0,
      cleaningFee: data?.cleaningFee || 0,
      airbnbPetFeeAmount: data?.airbnbPetFeeAmount || 0,
      squareMeters: data?.squareMeters || 0,
      language: data?.language || "",
      instantBookable: data?.instantBookable || null,
      instantBookableLeadTime: data?.instantBookableLeadTime || null,
      minNights: data?.minNights || null,
      maxNights: data?.maxNights || null,
      contactName: data?.contactName || "",
      contactPhone1: data?.contactPhone1 || "",
      contactLanguage: data?.contactLanguage || "",
      propertyLicenseNumber: data?.propertyLicenseNumber || "",
    };
  }

  // Create a listing object from hostaway client data
  private createHostifyListingObject(data: any) {
    return {
      id: data?.id,
      name: data?.name,
      description: data?.description,
      externalListingName: data?.name,
      address: data?.address || "",
      personCapacity: data?.personCapacity,
      guests: data?.person_capacity || 0,
      price: data?.default_daily_price || 0,
      guestsIncluded: data?.guests_included || 0,
      priceForExtraPerson: data?.priceForExtraPerson || 0,
      currencyCode: data?.currency || "USD",
      internalListingName: data?.nickname || "",
      country: data?.country || "",
      countryCode: data?.countryCode || "",
      state: data?.state || "",
      city: data?.city || "",
      street: data?.street || "",
      zipcode: data?.zipcode || "",
      lat: data?.lat || 0,
      lng: data?.lng || 0,
      propertyType: data?.property_type || "",
      checkInTimeStart: (data.checkin_start && parseInt(data.checkin_start.split(":")[0], 10)) || 0,
      checkInTimeEnd: (data.checkin_end && parseInt(data.checkin_end.split(":")[0], 10)) || 0,
      checkOutTime: (data.checkout && parseInt(data.checkout.split(":")[0], 10)) || 0,
      timeZoneName: data?.timezone || data?.time_zone || data?.timeZoneName || null,
      wifiUsername: data?.wifiUsername || "(NO WIFI)",
      wifiPassword: data?.wifiPassword || "(NO PASSWORD)",
      bookingcomPropertyRoomName: data?.bookingcomPropertyRoomName || "",
      ownerName: data?.ownerName || "",
      ownerEmail: data?.ownerEmail || "",
      ownerPhone: data?.ownerPhone || "",
      propertyTypeId: data?.property_type_id || null,
      roomType: data?.room_type || "",
      bedroomsNumber: data?.bedrooms || 0,
      bathroomsNumber: data?.bathrooms || 0,
      // bathroomType: data?.bathroomType || "",
      // guestBathroomsNumber: data?.guestBathroomsNumber || 0,
      cleaningFee: data?.cleaning_fee || 0,
      airbnbPetFeeAmount: data?.pets_fee || 0,
      squareMeters: data?.area || 0,
      language: data?.language || "",
      instantBookable: data?.instant_booking || null,
      instantBookableLeadTime: data?.instantBookableLeadTime || null,
      minNights: data?.min_nights || null,
      maxNights: data?.max_nights || null,
      contactName: data?.contactName || "",
      contactPhone1: data?.contactPhone1 || "",
      contactLanguage: data?.contactLanguage || "",
      propertyLicenseNumber: data?.propertyLicenseNumber || "",
      tags: data?.tags || null,
      integration_id: data?.integration_id || data?.fs_integration_type || data?.target_id || data?.channel_account_id || null,

    };
  }

  private isValidTimeZone(tz?: string) {
    if (!tz) return false;
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  private mapStateToTimeZone(stateCode?: string) {
    const state = (stateCode || "").toUpperCase();
    const pacific = ["CA", "OR", "WA", "NV"];
    const mountain = ["AZ", "UT", "CO", "NM", "ID", "MT", "WY"];
    const central = [
      "TX",
      "OK",
      "KS",
      "NE",
      "SD",
      "ND",
      "MN",
      "IA",
      "MO",
      "AR",
      "LA",
      "WI",
      "IL",
      "MS",
      "AL",
    ];

    if (pacific.includes(state)) return "America/Los_Angeles";
    if (mountain.includes(state)) return "America/Denver";
    if (central.includes(state)) return "America/Chicago";
    return "America/New_York";
  }

  private normalizeTimeZoneCandidate(candidate?: string) {
    if (!candidate) return "";
    const normalized = candidate.trim();
    const lower = normalized.toLowerCase();
    const aliases: Record<string, string> = {
      "eastern time": "America/New_York",
      "central time": "America/Chicago",
      "mountain time": "America/Denver",
      "pacific time": "America/Los_Angeles",
      "us/eastern": "America/New_York",
      "us/central": "America/Chicago",
      "us/mountain": "America/Denver",
      "us/pacific": "America/Los_Angeles",
    };
    if (aliases[lower]) return aliases[lower];
    return normalized;
  }

  private resolveTimeZone(listing: any) {
    const candidateRaw =
      listing?.timeZoneName ||
      listing?.timezone ||
      listing?.time_zone ||
      listing?.listingTimeZoneName ||
      "";
    const candidate = this.normalizeTimeZoneCandidate(candidateRaw);
    if (this.isValidTimeZone(candidate)) return { timeZone: candidate, missing: false };
    if (listing?.state) return { timeZone: this.mapStateToTimeZone(listing.state), missing: false };
    if (listing?.address) {
      const match = listing.address.match(/\b([A-Z]{2})\b/);
      if (match?.[1]) return { timeZone: this.mapStateToTimeZone(match[1]), missing: false };
    }
    logger.warn(`Missing timezone for listing ${listing?.id || "unknown"}`);
    return { timeZone: "", missing: true };
  }

  private formatTimeLabel(hour: number, minute: number) {
    const period = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return minute === 0
      ? `${hour12}${period}`
      : `${hour12}:${minute.toString().padStart(2, "0")}${period}`;
  }

  private parseTime(value?: string | number | null) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      if (value === 0) return null;
      return { hour: value, minute: 0 };
    }
    if (!value) return null;
    const match = value.toString().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const period = match[3]?.toUpperCase();
    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
    return { hour, minute };
  }

  private getOffsetMinutes(timeZone: string, date: Date) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const values: Record<string, string> = {};
    parts.forEach((p) => {
      values[p.type] = p.value;
    });
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    );
    return (asUtc - date.getTime()) / 60000;
  }

  private convertToEastern(timeValue: string | number | null, timeZone: string) {
    const parsed = this.parseTime(timeValue);
    if (!parsed) return null;
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .reduce((acc: Record<string, string>, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});

    const utcBase = Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      parsed.hour,
      parsed.minute
    );
    const listingOffset = this.getOffsetMinutes(timeZone, new Date(utcBase));
    const utcMillis = utcBase - listingOffset * 60000;
    const easternDate = new Date(utcMillis);
    const easternParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(easternDate)
      .reduce((acc: Record<string, string>, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});

    const hour = parseInt(easternParts.hour || "0", 10);
    const minute = parseInt(easternParts.minute || "0", 10);
    const period = (easternParts.dayPeriod || "AM").toUpperCase();
    const adjustedHour = period === "PM" && hour < 12 ? hour + 12 : hour;
    const finalHour = period === "AM" && hour === 12 ? 0 : adjustedHour;
    return this.formatTimeLabel(finalHour, minute);
  }

  private getReadableTimeZone(timeZone: string) {
    const labels: Record<string, string> = {
      "America/New_York": "Eastern Time",
      "America/Chicago": "Central Time",
      "America/Denver": "Mountain Time",
      "America/Phoenix": "Mountain Time",
      "America/Los_Angeles": "Pacific Time",
      "America/Anchorage": "Alaska Time",
      "Pacific/Honolulu": "Hawaii Time",
    };
    return labels[timeZone] || timeZone;
  }

  private buildTimeValue(raw: any) {
    const parsed = this.parseTime(raw);
    if (!parsed) return null;
    return this.formatTimeLabel(parsed.hour, parsed.minute);
  }

  private buildAddress(listing: any) {
    const parts = [listing?.address, listing?.city, listing?.state, listing?.zipcode]
      .filter((p) => !!p)
      .map((p) => String(p).trim());
    return parts.join(", ");
  }

  private normalizeListingOverview(listing: any) {
    const resolvedTimeZone = this.resolveTimeZone(listing);
    const timeZoneIdentifier = resolvedTimeZone.timeZone;
    const checkInLocalRaw =
      listing?.checkInLocal ||
      listing?.checkin_start ||
      listing?.checkInTimeStart ||
      listing?.checkInTime ||
      null;
    const checkOutLocalRaw =
      listing?.checkOutLocal ||
      listing?.checkout ||
      listing?.checkOutTime ||
      null;

    const checkInLocal = this.buildTimeValue(checkInLocalRaw);
    const checkOutLocal = this.buildTimeValue(checkOutLocalRaw);

    const checkInEastern =
      !resolvedTimeZone.missing &&
      timeZoneIdentifier !== "America/New_York" &&
      checkInLocal
        ? this.convertToEastern(checkInLocalRaw, timeZoneIdentifier)
        : null;
    const checkOutEastern =
      !resolvedTimeZone.missing &&
      timeZoneIdentifier !== "America/New_York" &&
      checkOutLocal
        ? this.convertToEastern(checkOutLocalRaw, timeZoneIdentifier)
        : null;

    const bathroomsNumber =
      listing?.bathroomsNumber !== undefined
        ? listing?.bathroomsNumber
        : listing?.bathrooms;
    const bedrooms =
      listing?.bedroomsNumber !== undefined ? listing?.bedroomsNumber : listing?.bedrooms;
    const fullBaths =
      bathroomsNumber !== undefined && bathroomsNumber !== null
        ? Math.floor(Number(bathroomsNumber))
        : listing?.fullBathrooms ?? listing?.fullBath ?? null;
    const halfBaths =
      listing?.guestBathroomsNumber ??
      (typeof bathroomsNumber === "number" && bathroomsNumber % 1 >= 0.5 ? 1 : null);

    return {
      ...listing,
      listingNickname:
        listing?.listingNickname ||
        listing?.nickname ||
        listing?.internalListingName ||
        listing?.externalListingName ||
        listing?.name ||
        "",
      listingTitle: listing?.listingTitle || listing?.name || listing?.externalListingName || "",
      fullAddress: listing?.fullAddress || this.buildAddress(listing),
      propertyType:
        listing?.propertyType ||
        listing?.propertyTypeName ||
        listing?.property_type ||
        listing?.roomType ||
        "",
      timezoneIdentifier: timeZoneIdentifier || null,
      timezoneName: timeZoneIdentifier ? this.getReadableTimeZone(timeZoneIdentifier) : null,
      checkInLocal,
      checkOutLocal,
      checkInEastern,
      checkOutEastern,
      bedrooms: bedrooms ?? null,
      fullBaths: fullBaths ?? null,
      halfBaths: halfBaths ?? null,
      capacity:
        listing?.capacity ??
        listing?.guests ??
        listing?.maxGuests ??
        listing?.guests_included ??
        listing?.personCapacity ??
        null,
      imageUrl: listing?.imageUrl || listing?.picture || listing?.images?.[0]?.url || null,
    };
  }

  // Save listing images
  // private async saveListingImages(
  //   entityManager: EntityManager,
  //   images: any[],
  //   listingId: number
  // ) {
  //   // const imageObjs = images.map((image) => ({
  //   //   caption: image.caption,
  //   //   vrboCaption: image.vrboCaption,
  //   //   airbnbCaption: image.airbnbCaption,
  //   //   url: image.url,
  //   //   sortOrder: image.sortOrder,
  //   //   listing: listingId,
  //   // }));

  //   // await entityManager.save(ListingImage, imageObjs);

  //   if (!images || images.length === 0) return;

  //   const firstImage = images[0];

  //   const imageObj = {
  //     caption: firstImage.caption,
  //     vrboCaption: firstImage.vrboCaption,
  //     airbnbCaption: firstImage.airbnbCaption,
  //     url: firstImage.url,
  //     sortOrder: firstImage.sortOrder,
  //     listing: listingId,
  //   };

  //   await entityManager.save(ListingImage, imageObj);
  // }

  // Save listing tags
  // private async saveListingTags(
  //   entityManager: EntityManager,
  //   tags: {id:number;name:string}[],
  //   listingId: number
  // ) {
  //   const listingTagsObjs = tags.map((tag) => ({
  //     tagId: tag.id,
  //     name: tag.name,
  //     listing: listingId,
  //   }))
  //   await entityManager.save(ListingTags, listingTagsObjs);
  // }

  // Save listing bedTypes
  private async saveListingBedTypes(
    entityManager: EntityManager,
    bedTypes: { id: number; bedTypeId: number; quantity: number, bedroomNumber: number; }[],
    listingId: number
  ) {
    const listingBedTypesObj = bedTypes.map((bedType) => ({
      id: bedType.id,
      bedTypeId: bedType.bedTypeId,
      quantity: bedType.quantity,
      bedroomNumber: bedType.bedroomNumber,
      listing: listingId,
    }));
    await entityManager.save(ListingBedTypes, listingBedTypesObj);
  }

  // Save listing amenities
  // private async saveListingAmenities(
  //   entityManager: EntityManager,
  //   amenities: { id: number; amenityId: number; amenityName: string; }[],
  //   listingId: number
  // ) {
  //   const listingAmenitiesObj = amenities.map((amenity) => ({
  //     id: amenity.id,
  //     amenityId: amenity.amenityId,
  //     amenityName: amenity.amenityName,
  //     listing: listingId,
  //   }));
  //   await entityManager.save(ListingAmenities, listingAmenitiesObj);
  // }

  async getListings(userId: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.images", "listingImages");

    if (includeDeleted) {
      query.withDeleted();
    }

    const listings = await query.getMany();
    const hostifyApiKey = process.env.HOSTIFY_API_KEY;

    if (!hostifyApiKey) return listings.map((listing) => this.normalizeListingOverview(listing));

    try {
      const integrations = await this.hostifyClient.getIntegrations(hostifyApiKey);

      const enriched = listings.map((listing: any) => {
        const integration = integrations.find((i: any) =>
          String(i.id) === String(listing.integration_id)
        );

        return {
          ...listing,
          integration_name: integration
            ? integration.nickname || integration.full_name || integration.user
            : "-",
          integration_picture: integration?.picture || null,
        };
      });

      return enriched.map((listing) => this.normalizeListingOverview(listing));
    } catch (error) {
      logger.error("Error enriching listings with integrations:", error);
      return listings.map((listing) => this.normalizeListingOverview(listing));
    }
  }

  async getListingNames(userId: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName", "listing.deletedAt"]);

    if (includeDeleted) {
      query.withDeleted();
    }

    return await query.getMany();
  }

  async getListingById(listing_id: string, userId: string) {
    const result = await this.listingRepository
      .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.images", "listingImages")
      .leftJoinAndSelect("listing.listingBedTypes", "listingBedTypes")
      .leftJoinAndSelect("listing.listingAmenities", "listingAmenities")
      .where("listing.listingId = :id", { id: Number(listing_id) })
      // .andWhere("listing.userId = :userId", { userId })
      .getOne();

    return result;
  }

  async getListingInfo(listingId: number, userId: string) {
    const result = await this.listingRepository.findOne({
      where: {
        id: listingId,
      },
      relations: ['images', 'listingAmenities']
    });

    return result;
  }

  async getListingsByTagIds(tagIds: number[], userId?: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name","listing.internalListingName",
        "listing.address", "listing.state", "listing.city"
      ])
      .leftJoin("listing.listingTags", "listingTags")
      .where("listingTags.tagId IN (:...tagIds)", { tagIds });

    if (includeDeleted) {
      query.withDeleted();
    }

    // if (userId) {
    //   query.andWhere("listing.userId = :userId", { userId });
    // }

    const listings = await query.getMany();
    return listings;
  }

  async getListingsByPropertyTypes(propertyTypes: string[], userId?: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName",
        "listing.address", "listing.state", "listing.city"
      ]);

    if (includeDeleted) {
      query.withDeleted();
    }

    // if (userId) {
    //   query.andWhere("listing.userId = :userId", { userId });
    // }

    if (propertyTypes && propertyTypes.length > 0) {
      query.andWhere(new Brackets(qb => {
        propertyTypes.forEach((type, index) => {
          if (index === 0) {
            qb.where("FIND_IN_SET(:type" + index + ", listing.tags) > 0", { ["type" + index]: type });
          } else {
            qb.orWhere("FIND_IN_SET(:type" + index + ", listing.tags) > 0", { ["type" + index]: type });
          }
        });
      }));
    }

    const listings = await query.getMany();
    return listings;
  }

  async getPmListings(includeDeleted: boolean = false) {
    // Optimized: Filter at database level instead of fetching all and filtering in JS
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .where("FIND_IN_SET('pm', listing.tags) > 0");

    if (includeDeleted) {
      query.withDeleted();
    }

    return await query.getMany();
  }

  /**
   * Get all listings for name lookup purposes (includes inactive properties).
   * Only fetches id and internalListingName for efficiency.
   */
  async getAllListingsForLookup(includeDeleted: boolean = false) {
    return await this.listingRepository.find({
      select: ['id', 'internalListingName'],
      withDeleted: includeDeleted
    });
  }

  async getLaunchListings(includeDeleted: boolean = false) {
    const listings = await this.listingRepository.find({ withDeleted: includeDeleted });
    const launchListings = listings.filter(listing => {
      let tags = [];
      tags = listing.tags ? listing.tags.split(',') : [];
      return tags.includes("Launch");
    });

    return launchListings;
  }


  async getListingAddresses(userId: string, includeDeleted: boolean = false) {
    const listings = await this.listingRepository.find({
      select: ['id', 'address', 'deletedAt'],
      withDeleted: includeDeleted
    });

    return listings;
  }

  async getListingScore(listingId: number) {
    const listingScore = await this.listingScore.findOneBy({
      listingId: listingId,
    });

    return listingScore;
  }

  async updateListingScore(scoreData: any) {
    const listingScore = await this.listingScore.update(
      { listingId: scoreData.listingId },
      scoreData
    );
    return listingScore;
  }

  async saveListingScore(request: Request) {
    const scoreData = request.body;

    const checkListing = await this.getListingScore(scoreData.listingId);

    if (checkListing) {
      // Update the existing record
      const updateResult = await this.updateListingScore(scoreData);

      if (updateResult.affected > 0) {
        return {
          status: true,
          message: "Data updated successfully!!!",
        };
      }

      return {
        status: false,
        message: "Data not updated!!!",
      };
    }

    // If no existing record, create a new one
    const score = await this.listingScore.save(scoreData);

    if (score) {
      return {
        status: true,
        message: "Data saved successfully!!!",
        data: score,
      };
    }

    return {
      status: false,
      message: "Data not saved!!!",
    };


  }

  public async getListingPmFee(listingId?: number) {
    const listingPmFee = await this.listingScore.find({
      where: { listingId },
      select: ['listingId', 'pmFee'],
    });

    return listingPmFee;
  }


  public async saveListingUpdate(listingUpdate: ListingUpdate, userId: string) {
    const newUpdate = new ListingUpdateEntity();
    newUpdate.listingId = listingUpdate.listingId;
    newUpdate.date = listingUpdate.date;
    newUpdate.action = listingUpdate.action;
    newUpdate.userId = userId;
    return await this.listingUpdateRepo.save(newUpdate);
  }

  public async getListingUpdates(listingId: number, userId: string, page: number) {
    const offset = page ? (page - 1) * 10 : 0;
    const updates = await this.listingUpdateRepo.find({
      where: { listingId, userId },
      order: { id: 'DESC' },
      take: 10,
      skip: offset,
    });

    return updates;
  }

  public async getListingChangeLogsByListingId(listingId: number, page = 1, limit = 10, dateFrom?: string, dateTo?: string) {
    const qb = this.listingChangeLogRepo.createQueryBuilder("log")
      .leftJoinAndSelect("log.listing", "listing")
      .where("log.listingId = :listingId", { listingId })
      .orderBy("log.changedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (dateFrom) {
      qb.andWhere("log.changedAt >= :dateFrom", { dateFrom });
    }
    if (dateTo) {
      qb.andWhere("log.changedAt <= :dateTo", { dateTo });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  public async getListingChangeLogs(filters: { listingId?: number; dateFrom?: string; dateTo?: string; changedBy?: string; field?: string; page?: number; limit?: number; }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const qb = this.listingChangeLogRepo.createQueryBuilder("log")
      .leftJoinAndSelect("log.listing", "listing")
      .orderBy("log.changedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.listingId) {
      qb.andWhere("log.listingId = :listingId", { listingId: filters.listingId });
    }
    if (filters.changedBy) {
      qb.andWhere("log.changedBy = :changedBy", { changedBy: filters.changedBy });
    }
    if (filters.dateFrom) {
      qb.andWhere("log.changedAt >= :dateFrom", { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      qb.andWhere("log.changedAt <= :dateTo", { dateTo: filters.dateTo });
    }
    if (filters.field) {
      qb.andWhere("JSON_SEARCH(log.diff, 'one', :field) IS NOT NULL", { field: filters.field });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  public async createListingDetail(body: Partial<ListingDetail>, userId: string) {
    const { propertyOwnershipType, listingId, statementDurationType, claimProtection, hidePetFee, techFee, techFeeAmount } = body;
    const listingDetail = new ListingDetail();
    listingDetail.listingId = listingId;
    listingDetail.propertyOwnershipType = propertyOwnershipType;
    listingDetail.statementDurationType = statementDurationType;
    listingDetail.claimProtection = claimProtection;
    listingDetail.hidePetFee = hidePetFee;
    listingDetail.techFee = techFee;
    listingDetail.techFeeAmount = techFeeAmount;
    listingDetail.createdBy = userId;
    return await this.listingDetailRepo.save(listingDetail);
  };

  public async updateListingDetail(body: Partial<ListingDetail>, listingDetail: Partial<ListingDetail>, userId: string) {
    listingDetail.propertyOwnershipType = body.propertyOwnershipType;
    listingDetail.statementDurationType = body.statementDurationType;
    listingDetail.claimProtection = body.claimProtection;
    listingDetail.hidePetFee = body.hidePetFee;
    listingDetail.techFee = body.techFee;
    listingDetail.techFeeAmount = body.techFeeAmount;
    listingDetail.updatedBy = userId;
    return await this.listingDetailRepo.save(listingDetail);
  }

  public async saveListingDetails(body: Partial<ListingDetail>, userId: string) {
    const listingDetail = await this.listingDetailRepo.findOne({ where: { listingId: body.listingId } });
    if (listingDetail) {
      return this.updateListingDetail(body, listingDetail, userId);
    }
    return this.createListingDetail(body, userId);
  }

  public async getListingDetail(listingId?: number) {
    if (listingId) {
      return await this.listingDetailRepo.findOne({ where: { listingId } });
    }
    return await this.listingDetailRepo.find();
  }

  public async getListingDetailByListingId(listingId: number) {
      return await this.listingDetailRepo.findOne({ where: { listingId } });
  }

  public async autoSyncListings(){
    // const connectedAccounts = await this.connectedAccountInfoRepository.find({
    //   where: { account: "pm" },
    // });

    // for (const account of connectedAccounts) {
    //   try {
    //     await this.syncHostifyListings(account.userId);
    //   } catch (error) {
    //     logger.error(`Error syncing listings for user ${account.userId}:`, error);
    //   }
    // }
    try {
      await this.syncHostifyListings('system');
    } catch (error) {
      logger.error(`Error syncing listings for system user:`, error);
    }
  }


  async getListingsByCity(city: string[], userId?: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName",
        "listing.address", "listing.state", "listing.city"
      ])
      .where("listing.city IN (:...city)", { city });

    if (includeDeleted) {
      query.withDeleted();
    }

    // if (userId) {
    //   query.andWhere("listing.userId = :userId", { userId });
    // }

    const listings = await query.getMany();
    return listings;
  }

  async getListingsByState(state: string[], userId?: string, includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName",
        "listing.address", "listing.city", "listing.state"
      ])
      .where("listing.state IN (:...state)", { state });

    if (includeDeleted) {
      query.withDeleted();
    }

    // if (userId) {
    //   query.andWhere("listing.userId = :userId", { userId });
    // }

    const listings = await query.getMany();
    return listings;
  }

  public async getStates(includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing_info")
      .select("DISTINCT listing_info.state", "state")
      .where("listing_info.state IS NOT NULL AND listing_info.state != ''");

    if (includeDeleted) {
      query.withDeleted();
    }

    return await query.getRawMany();
  }


  public async getCities(includeDeleted: boolean = false) {
    const query = this.listingRepository
      .createQueryBuilder("listing_info")
      .select("DISTINCT listing_info.city", "city")
      .where("listing_info.city IS NOT NULL AND listing_info.city != ''");

    if (includeDeleted) {
      query.withDeleted();
    }

    return await query.getRawMany();
  }

  public async getPropertyTypes() {
    const propertyTypes = await this.hostAwayClient.getPropertyTypes();
    return propertyTypes;
  }

  public async getCountries() {
    const countries = await this.hostAwayClient.getCountries();
    return countries;
  }

  public async getAmenities() {
    const amenities = await this.hostAwayClient.getAmenities();
    return amenities;
  }

  public async getBedTypes() {
    const bedTypes = await this.hostAwayClient.getBedTypes();
    return bedTypes;
  }

  public async getCurrencies() {
    const currencies = await this.hostAwayClient.getCurrencies();
    return currencies;
  }

  public async getCancellationPolicies(channel?: string) {
    const cancellationPolicies = await this.hostAwayClient.getCancellationPolicies(channel);
    return cancellationPolicies;
  }

  public async getTimezones() {
    const timeZones = await this.hostAwayClient.getTimeZones();
    return timeZones;
  }

  async getListingIdsForEachServiceType(userId: string) {
    const listingService = new ListingService();

    // Map each service type to its tag
    const serviceTags = {
      FULL_SERVICE: tagIds.FULL_SERVICE,
      LAUNCH_SERVICE: tagIds.LAUNCH_SERVICE,
      PRO_SERVICE: tagIds.PRO_SERVICE,
    } as const;

    // Run requests in parallel
    const entries = await Promise.all(
      (Object.keys(serviceTags) as (keyof typeof serviceTags)[]).map(async (key) => {
        const tagId = serviceTags[key];
        const listings = await listingService.getListingsByTagIds([tagId], userId);
        return [key, listings.map((l) => l.id)] as const;
      })
    );

    // Explicitly return each service type with its IDs
    return {
      FULL_SERVICE: entries.find(([key]) => key === "FULL_SERVICE")?.[1] ?? [],
      LAUNCH_SERVICE: entries.find(([key]) => key === "LAUNCH_SERVICE")?.[1] ?? [],
      PRO_SERVICE: entries.find(([key]) => key === "PRO_SERVICE")?.[1] ?? [],
    };
  }

  // async syncHostifyListings(userId: string) {
  //   const hostifyApiKey = process.env.HOSTIFY_API_KEY;

  //   if (!hostifyApiKey) {
  //     throw CustomErrorHandler.notFound('Hostify credentials not found');
  //   }

  //   const listings = await this.hostifyClient.getListings(hostifyApiKey);
  //   if (listings.length === 0) {
  //     throw new CustomErrorHandler(500, 'No listings found from Hostify');
  //   }

  //   //add/updated listing in db
  //   try {
  //     await appDatabase.manager.transaction(async (transactionalEntityManager) => {
  //       // Step 1: Fetch all listings for user
  //       const existingListings = await transactionalEntityManager.find(Listing);

  //       const existingListingIds = existingListings.map((l) => String(l.id));
  //       const listingIds = listings.map((l) => String(l.id));


  //       // Step 2: Update existing listings and add new listings
  //       for (const listing of listings) {
  //         const listingId = String(listing.id);

  //         //fetch listingDetails from hostify
  //         const listingInfo = await this.hostifyClient.getListingDetails(hostifyApiKey, listing.id);
  //         if (!listingInfo) continue;

  //         const photos = listingInfo.photos || [];
  //         const users = listingInfo?.users || [];
  //         const amenities = listingInfo?.amenities || [];
  //         const rooms = listingInfo?.rooms || [];
  //         const description = listingInfo?.description?.description || '';

  //         const ownerDetails = users.find((user: any) => user.roles === 'Listing Owner');
  //         const ownerName = ownerDetails && ownerDetails.first_name && ownerDetails.last_name ? `${ownerDetails.first_name} ${ownerDetails.last_name}` : '';
  //         const ownerEmail = ownerDetails?.username || '';
  //         const ownerPhone = ownerDetails?.phone || '';

  //         const listingObj = this.createHostifyListingObject({
  //           ...listing,
  //           address: listingInfo.listing.address,
  //           ownerEmail,
  //           ownerName,
  //           ownerPhone,
  //           description
  //         });


  //         const imageObj = photos && photos.length > 0 ? {
  //           url: photos[0]?.original_file,
  //           thumbnailUrl: photos[0]?.thumbnail_file,
  //           sortOrder: photos[0]?.sort_order,
  //           listing: listing.id,
  //         } : null;

  //         logger.info(`Syncing listing ID: ${listing.id} - ${listing.name}`);

  //         if (existingListingIds.includes(listingId)) {
  //           logger.info(`Updating listing ID: ${listing.id}`);
  //           await transactionalEntityManager.update(Listing, listing.id, listingObj);
  //           // handle images
  //           imageObj && await this.handleListingImages(listingObj as Listing, imageObj, transactionalEntityManager);

  //         } else {
  //           logger.info(`Adding new listing ID: ${listing.id}`);
  //           const savedListing = await transactionalEntityManager.save(Listing, listingObj);
  //           if (savedListing) {
  //             // handle images
  //             imageObj && await this.handleListingImages(savedListing as Listing, imageObj, transactionalEntityManager);
  //           }
  //         }


  //       }



  //     });

  //     return 1;
  //   } catch (error) {
  //     logger.error("Error syncing listings:", error);
  //     throw error;
  //   }


  // }

  async syncHostifyListings(userId: string) {
    const hostifyApiKey = process.env.HOSTIFY_API_KEY;
    if (!hostifyApiKey) throw CustomErrorHandler.notFound('Hostify credentials not found');

    // 1. Fetch all listings from Hostify (FAST)
    const listings = await this.hostifyClient.getListings(hostifyApiKey);
    if (!listings || listings.length === 0)
      throw new CustomErrorHandler(500, 'No listings found from Hostify');

    // Extract incoming IDs
    const incomingListingIds = listings.map((l) => String(l.id));

    // 2. Fetch listing details IN PARALLEL for max performance
    const listingDetails = await Promise.all(
      listings.map((l) => this.hostifyClient.getListingDetails(hostifyApiKey, l.id))
    );

    // Build a map for convenience
    const detailsMap = new Map<string, any>();
    listings.forEach((l, idx) => {
      detailsMap.set(String(l.id), listingDetails[idx]);
    });

    // Run everything inside transaction
    try {
      await appDatabase.manager.transaction(async (tx) => {
        // 3. Fetch existing listings once (including soft-deleted to prevent duplicate key errors)
        const existingListings = await tx.find(Listing, { withDeleted: true });
        const existingListingIds = existingListings.map((l) => String(l.id));
        const existingListingMap = new Map(existingListings.map((l) => [String(l.id), l]));

        // Track which listings are soft-deleted for reactivation
        const softDeletedListingIds = existingListings
          .filter((l) => l.deletedAt !== null)
          .map((l) => String(l.id));

        // 🤝 NEW listings = Hostify - DB (truly new, never existed before)
        const newListingIds = incomingListingIds.filter((id) => !existingListingIds.includes(id));

        // 🔄 UPDATED listings = intersection (includes soft-deleted that need reactivation)
        const updatedListingIds = incomingListingIds.filter((id) => existingListingIds.includes(id));

        // ❌ REMOVED listings = DB - Hostify (only consider active listings for removal)
        const activeListingIds = existingListings
          .filter((l) => l.deletedAt === null)
          .map((l) => String(l.id));
        const removedListingIds = activeListingIds.filter((id) => !incomingListingIds.includes(id));

        // ------------------------------
        // 🆕 4. Handle NEW LISTINGS
        // ------------------------------
        for (const listingId of newListingIds) {
          const listing = listings.find((x) => String(x.id) === listingId);
          const info = detailsMap.get(listingId);
          if (!listing || !info) continue;

          const listingObj = this.buildListingObject(listing, info);

          const saved = await tx.save(Listing, listingObj);

          if (info.photos?.[0]) {
            const imageObj = this.buildImageObject(listing.id, info.photos[0]);
            await this.handleListingImages(saved, imageObj, tx);
          }

          logger.info(`Added new listing ID: ${listingId}`);
        }

        // ------------------------------
        // ♻️ 5. Handle UPDATED LISTINGS
        // ------------------------------
        for (const listingId of updatedListingIds) {
          const listing = listings.find((x) => String(x.id) === listingId);
          const info = detailsMap.get(listingId);
          if (!listing || !info) continue;

          const listingObj = this.buildListingObject(listing, info);
          const existing = existingListingMap.get(listingId);
          if (existing) {
            const diffs = this.buildListingDiff(existing, listingObj);
            if (diffs.length > 0) {
              await tx.insert(ListingChangeLog, {
                listingId: existing.id,
                hostifyListingId: existing.id,
                changedBy: "Hostify Sync",
                diff: diffs,
                source: "hostify_hourly_sync"
              });
            }
          }

          // Check if this listing was soft-deleted and needs reactivation
          const isReactivation = softDeletedListingIds.includes(listingId);
          if (isReactivation) {
            // Reactivate soft-deleted listing by clearing deletedAt and deletedBy
            await tx.update(Listing, listing.id, {
              ...listingObj,
              deletedAt: null,
              deletedBy: null
            });
            logger.info(`Reactivated soft-deleted listing ID: ${listingId}`);
          } else {
            await tx.update(Listing, listing.id, listingObj);
            logger.info(`Updated listing ID: ${listingId}`);
          }

          if (info.photos?.[0]) {
            const imageObj = this.buildImageObject(listing.id, info.photos[0]);
            await this.handleListingImages(listingObj, imageObj, tx);
          }
        }

        // ------------------------------
        // ❌ 6. Handle REMOVED LISTINGS
        // ------------------------------
        for (const listingId of removedListingIds) {
          logger.info(`Listing removed from Hostify: ${listingId}`);

          // Soft delete (recommended)
          await tx.update(Listing, listingId, { deletedAt: new Date(), deletedBy: "system" });

          // If you prefer hard delete, replace with:
          // await tx.delete(Listing, listingId);
        }
      });

      return 1;

    } catch (error) {
      logger.error("Error syncing listings:", error);
      throw error;
    }
  }

  private buildListingObject(listing: any, info: any) {
    const photos = info.photos || [];
    const users = info.users || [];
    const description = info.description?.description || '';

    const owner = users.find((u: any) => u.roles === 'Listing Owner');

    return this.createHostifyListingObject({
      ...listing,
      address: info.listing.address,
      ownerEmail: owner?.username || '',
      ownerName: owner ? `${owner.first_name} ${owner.last_name}` : '',
      ownerPhone: owner?.phone || '',
      description
    });
  }

  private buildImageObject(listingId: number, photo: any) {
    return {
      url: photo.original_file,
      thumbnailUrl: photo.thumbnail_file,
      sortOrder: photo.sort_order,
      listing: listingId
    };
  }

  private normalizeDiffValue(value: any) {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return Number(value);
    if (typeof value === "boolean") return value;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  private toComparableString(value: any) {
    const normalized = this.normalizeDiffValue(value);
    if (normalized === null) return "";
    if (typeof normalized === "object") {
      try {
        return JSON.stringify(normalized);
      } catch {
        return String(normalized);
      }
    }
    return String(normalized);
  }

  private buildListingDiff(existing: Listing, next: Partial<Listing>) {
    const fields = [
      { key: "name", label: "Name" },
      { key: "description", label: "Description" },
      { key: "internalListingName", label: "Nickname" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "zipcode", label: "Zip" },
      { key: "country", label: "Country" },
      { key: "timeZoneName", label: "Timezone" },
      { key: "propertyType", label: "Property Type" },
      { key: "roomType", label: "Room Type" },
      { key: "bedroomsNumber", label: "Bedrooms" },
      { key: "bathroomsNumber", label: "Bathrooms" },
      { key: "personCapacity", label: "Capacity" },
      { key: "guests", label: "Guests" },
      { key: "checkInTimeStart", label: "Check-In Start" },
      { key: "checkInTimeEnd", label: "Check-In End" },
      { key: "checkOutTime", label: "Check-Out" },
      { key: "tags", label: "Tags" }
    ];

    const diffs: Array<{ field: string; old: any; new: any }> = [];
    fields.forEach(({ key, label }) => {
      const prevVal = this.normalizeDiffValue((existing as any)[key]);
      const nextVal = this.normalizeDiffValue((next as any)[key]);
      const prevStr = this.toComparableString(prevVal);
      const nextStr = this.toComparableString(nextVal);
      if (prevStr !== nextStr) {
        diffs.push({ field: label, old: prevVal, new: nextVal });
      }
    });
    return diffs;
  }


  async handleListingImages(listing: any, imageInfo: any, transactionalEntityManager: EntityManager) {
    //delete existing images
    await transactionalEntityManager.delete(ListingImage, { listing: { id: listing.id } });
    //add new image
    await transactionalEntityManager.save(ListingImage, imageInfo);
  }

  async handleListingAmenities(listing: Listing, amenitiesInfo: any[], transactionalEntityManager: EntityManager) {
    //delete existing amenities
    await transactionalEntityManager.delete(ListingAmenities, { listing: { id: listing.id } });
    //add new amenities
    for (const amenity of amenitiesInfo) {
      const amenityObj = {
        id: amenity.id,
        amenityId: amenity.target_id,
        amenityName: amenity.name,
        description: amenity.description,
        listing: listing,
      };
      await transactionalEntityManager.save(ListingAmenities, amenityObj);
    }
  }

  async getChildListings(listingId: number) {
    const hostifyApiKey = process.env.HOSTIFY_API_KEY;
    if (!hostifyApiKey) throw CustomErrorHandler.notFound('Hostify credentials not found');

    const [childListings, integrations] = await Promise.all([
      this.hostifyClient.getChildListings(hostifyApiKey, String(listingId)),
      this.hostifyClient.getIntegrations(hostifyApiKey)
    ]);

    // Map integration names to child listings
    return childListings.map((listing: any) => {
      const integration = integrations.find((i: any) =>
        i.id === listing.integration_id ||
        i.id === listing.fs_integration_type ||
        i.id === listing.target_id ||
        i.id === listing.channel_account_id
      );

      return {
        ...listing,
        integration_name: integration ? (integration.nickname || integration.full_name || integration.user) : '-',
        integration_picture: integration?.picture || null
      };
    });
  }

}
