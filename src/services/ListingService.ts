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
import { ownerDetails } from "../constant";
import { ListingDetail } from "../entity/ListingDetails";
import { ListingTags } from "../entity/ListingTags";
import logger from "../utils/logger.utils";

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

  // Fetch listings from hostaway client and save in our database if not present
  async syncHostawayListing(userId: string) {
    const hostawayCredentials = await this.connectedAccountInfoRepository.findOne({
      where: { userId, account: "pm" },
    });

    if (!hostawayCredentials) {
      throw CustomErrorHandler.notFound('Hostaway credentials not found');
    }

    const { clientId, clientSecret } = hostawayCredentials;
    const listings = await this.hostAwayClient.getListing(clientId, clientSecret);

    try {
      await appDatabase.manager.transaction(async (transactionalEntityManager) => {
        // Step 1: Fetch all listings for user and delete them (cascade deletes images too)
        const existingUserListings = await transactionalEntityManager.find(Listing, {
          where: { userId },
        });

        if (existingUserListings.length > 0) {
          const userListingIds = existingUserListings.map(l => l.listingId);
          await transactionalEntityManager.delete(Listing, { listingId: In(userListingIds) });
        }

        // Step 2: Insert fresh listings from Hostaway
        for (const listing of listings) {
          const listingObj = this.createListingObject(listing, userId);
          const savedListing = await transactionalEntityManager.save(Listing, listingObj);

          await this.saveListingImages(
            transactionalEntityManager,
            listing["listingImages"],
            savedListing.listingId
          );

          await this.saveListingTags(
            transactionalEntityManager,
            listing["listingTags"],
            savedListing.listingId
          )
        }
      });

      return 1;
    } catch (error) {
      console.error("Error syncing listings:", error);
      throw error;
    }
  }


  // Create a listing object from hostaway client data
  private createListingObject(data: any, userId: string) {
    return {
      id: data?.id,
      name: data?.name,
      description: data?.description,
      externalListingName: data?.externalListingName,
      address: data?.address,
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
    };
  }

  // Save listing images
  private async saveListingImages(
    entityManager: EntityManager,
    images: any[],
    listingId: number
  ) {
    const imageObjs = images.map((image) => ({
      caption: image.caption,
      vrboCaption: image.vrboCaption,
      airbnbCaption: image.airbnbCaption,
      url: image.url,
      sortOrder: image.sortOrder,
      listing: listingId,
    }));

    await entityManager.save(ListingImage, imageObjs);
  }

  // Save listing tags
  private async saveListingTags(
    entityManager: EntityManager,
    tags: {id:number;name:string}[],
    listingId: number
  ) {
    const listingTagsObjs = tags.map((tag) => ({
      tagId: tag.id,
      name: tag.name,
      listing: listingId,
    }))
    await entityManager.save(ListingTags, listingTagsObjs);
  }

  async getListings(userId: string) {
      const listingsWithImages = await this.listingRepository
        .createQueryBuilder("listing")
        .leftJoinAndSelect("listing.images", "listingImages")
        .leftJoinAndSelect("listing.guideBook", "GuideBook")
        .where("listing.userId = :userId", { userId })
        .getMany();

    return listingsWithImages;
  }

  async getListingNames(userId: string) {
    const listings = await this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name", "listing.internalListingName"])
      .where("listing.userId = :userId", { userId })
      .getMany();

    return listings;
  }

  async getListingById(listing_id: string, userId: string) {
    const result = await this.listingRepository
      .createQueryBuilder("listing")
      .leftJoinAndSelect("listing.images", "listingImages")
      .where("listing.listingId = :id", { id: Number(listing_id) })
      .andWhere("listing.userId = :userId", { userId })
      .getOne();

    return result;
  }

  async getListingsByTagIds(tagIds: number[], userId?: string) {
    const query = this.listingRepository
      .createQueryBuilder("listing")
      .select(["listing.id", "listing.name","listing.internalListingName",
        "listing.address"
      ])
      .leftJoin("listing.listingTags", "listingTags")
      .where("listingTags.tagId IN (:...tagIds)", { tagIds });

    if (userId) {
      query.andWhere("listing.userId = :userId", { userId });
    }

    const listings = await query.getMany();
    return listings;
  }

  async getDeviceIdByListingId(listing_id: number) {
    const listing = await this.listingRepository.findOne({
      where: { id: listing_id },
    });
    if (listing) {
      const listingLockInfo = await this.listingLockRepository.findOne({
        where: { listing_id: listing.listingId, status: 1 },
      });
      return listingLockInfo?.lock_id;
    } else {
      return null;
    }
  }

  async getListingAddresses(userId: string) {
    const listings = await this.listingRepository.find({
      where: { userId },
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
    listingDetail.scheduleType= body.scheduleType;
    listingDetail.intervalMonth = body.intervalMonth;
    listingDetail.dayOfWeek = body.dayOfWeek;
    listingDetail.weekOfMonth = body.weekOfMonth;
    listingDetail.dayOfMonth = body.dayOfMonth;
    listingDetail.scheduling = body.scheduling;
    listingDetail.createdBy = userId;
    return await this.listingDetailRepo.save(listingDetail);
  };

  public async updateListingDetail(body: Partial<ListingDetail>, listingDetail: Partial<ListingDetail>, userId: string) {
    listingDetail.propertyOwnershipType = body.propertyOwnershipType;
    listingDetail.statementDurationType = body.statementDurationType;
    listingDetail.claimProtection= body.claimProtection;
    listingDetail.hidePetFee=body.hidePetFee;
    listingDetail.scheduleType = body.scheduleType;
    listingDetail.intervalMonth = body.intervalMonth;
    listingDetail.dayOfWeek = body.dayOfWeek ? JSON.stringify(body.dayOfWeek) : null;
    listingDetail.weekOfMonth = body.weekOfMonth;
    listingDetail.dayOfMonth = body.dayOfMonth;
    listingDetail.scheduling = body.scheduling;
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
    const connectedAccounts = await this.connectedAccountInfoRepository.find({
      where: { account: "pm" },
    });

    for (const account of connectedAccounts) {
      try {
        await this.syncHostawayListing(account.userId);
      } catch (error) {
        logger.error(`Error syncing listings for user ${account.userId}:`, error);
      }
    }
  }

}

