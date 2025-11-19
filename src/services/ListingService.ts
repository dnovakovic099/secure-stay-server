import { EntityManager, In, Not } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { Listing } from "../entity/Listing";
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

  async getListings(userId: string) {
    const listings = await this.listingRepository
        .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.images", "listingImages")
        .getMany();

    return listings;
  }

  async getListingNames(userId: string) {
    const listings = await this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName"])
      // .where("listing.userId = :userId", { userId })
      .getMany();

    return listings;
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
      relations: ['images', 'listingBedTypes', 'listingAmenities', 'listingTags']
    });

    return result;
  }

  async getListingsByTagIds(tagIds: number[], userId?: string) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name","listing.internalListingName",
        "listing.address", "listing.state", "listing.city"
      ])
      .leftJoin("listing.listingTags", "listingTags")
      .where("listingTags.tagId IN (:...tagIds)", { tagIds });

    if (userId) {
      query.andWhere("listing.userId = :userId", { userId });
    }

    const listings = await query.getMany();
    return listings;
  }

  async getPmListings() {
    const listings = await this.listingRepository.find();
    const pmListings = listings.filter(listing => {
      let tags = [];
      tags = listing.tags ? listing.tags.split(',') : [];
      return tags.includes("pm");
    });

    return pmListings;
  }


  async getListingAddresses(userId: string) {
    const listings = await this.listingRepository.find({
      select: ['id', 'address']
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

  public async createListingDetail(body: Partial<ListingDetail>, userId: string) {
    const { propertyOwnershipType, listingId, statementDurationType } = body;
    const listingDetail = new ListingDetail();
    listingDetail.listingId = listingId;
    listingDetail.propertyOwnershipType = propertyOwnershipType;
    listingDetail.statementDurationType = statementDurationType;
    listingDetail.createdBy = userId;
    return await this.listingDetailRepo.save(listingDetail);
  };

  public async updateListingDetail(body: Partial<ListingDetail>, listingDetail: Partial<ListingDetail>, userId: string) {
    listingDetail.propertyOwnershipType = body.propertyOwnershipType;
    listingDetail.statementDurationType = body.statementDurationType;
    listingDetail.claimProtection= body.claimProtection;
    listingDetail.hidePetFee=body.hidePetFee;
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


  async getListingsByCity(city: string[], userId?: string) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName",
        "listing.address", "listing.state", "listing.city"
      ])
      .where("listing.city IN (:...city)", { city });

    if (userId) {
      query.andWhere("listing.userId = :userId", { userId });
    }

    const listings = await query.getMany();
    return listings;
  }

  async getListingsByState(state: string[], userId?: string) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName",
        "listing.address", "listing.city", "listing.state"
      ])
      .where("listing.state IN (:...state)", { state });

    if (userId) {
      query.andWhere("listing.userId = :userId", { userId });
    }

    const listings = await query.getMany();
    return listings;
  }

  public async getStates() {
    const states = await this.listingRepository
      .createQueryBuilder("listing_info")
      .select("DISTINCT listing_info.state", "state")
      .where("listing_info.state IS NOT NULL AND listing_info.state != ''")
      .getRawMany();

    return states;
  }


  public async getCities() {
    const cities = await this.listingRepository
      .createQueryBuilder("listing_info")
      .select("DISTINCT listing_info.city", "city")
      .where("listing_info.city IS NOT NULL AND listing_info.city != ''")
      .getRawMany();

    return cities;
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
        // 3. Fetch existing listings once
        const existingListings = await tx.find(Listing);
        const existingListingIds = existingListings.map((l) => String(l.id));

        // 🤝 NEW listings = Hostify - DB
        const newListingIds = incomingListingIds.filter((id) => !existingListingIds.includes(id));

        // 🔄 UPDATED listings = intersection
        const updatedListingIds = incomingListingIds.filter((id) => existingListingIds.includes(id));

        // ❌ REMOVED listings = DB - Hostify
        const removedListingIds = existingListingIds.filter((id) => !incomingListingIds.includes(id));

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

          await tx.update(Listing, listing.id, listingObj);

          if (info.photos?.[0]) {
            const imageObj = this.buildImageObject(listing.id, info.photos[0]);
            await this.handleListingImages(listingObj, imageObj, tx);
          }

          logger.info(`Updated listing ID: ${listingId}`);
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

}
