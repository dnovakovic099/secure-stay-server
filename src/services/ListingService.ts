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

  // Fetch listings from hostaway client and save in our database if not present
  async syncHostawayListing(userId: string) {

    const hostawayCredentials = await this.connectedAccountInfoRepository.findOne({ where: { userId, account: "pm" } });
    if (!hostawayCredentials) {
      throw CustomErrorHandler.notFound('Hoastaway credentials not found');
    }

    const { clientId, clientSecret } = hostawayCredentials;

    const listings = await this.hostAwayClient.getListing(clientId, clientSecret);

    try {
      await appDatabase.manager.transaction(
        async (transactionalEntityManager) => {
          for (let i = 0; i < listings.length; i++) {
            const existingListing = await transactionalEntityManager.findOneBy(
              Listing,
              { id: listings[i]?.id, userId }
            );

            existingListing.ownerName = ownerDetails[existingListing.id]?.name || "";
            existingListing.ownerEmail = ownerDetails[existingListing.id]?.email || "";
            existingListing.ownerPhone = ownerDetails[existingListing.id]?.phone || "";

            await transactionalEntityManager.save(existingListing)

            if (!existingListing) {
              const listingObj = this.createListingObject(listings[i], userId);
              const savedListing = await transactionalEntityManager.save(
                Listing,
                listingObj
              );
              await this.saveListingImages(
                transactionalEntityManager,
                listings[i]["listingImages"],
                savedListing.listingId
              );
            }
          }
        }
      );
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

}

// import { EntityManager, In, Not } from 'typeorm';
// import { HostAwayClient } from '../client/HostAwayClient';
// import { Listing } from '../entity/Listing';
// import { ListingImage } from '../entity/ListingImage';
// import { appDatabase } from '../utils/database.util';
// import { Request } from 'express';
// import { ListingLockInfo } from '../entity/ListingLock';
// import { GuideBook } from '../entity/GuideBook';

// export class ListingService {
//   private hostAwayClient = new HostAwayClient();
//   private listingRepository = appDatabase.getRepository(Listing);
//   private listingLockRepository = appDatabase.getRepository(ListingLockInfo);

//   //fetch listings from hostaway client and save in our database if not present
//   async syncHostawayListing() {
//     const listing = await this.hostAwayClient.getListing();

//     try {
//       await appDatabase.manager.transaction(
//         async (transactionalEntityManager) => {
//           for (let i = 0; i < listing.length; i++) {
//             const existingListing = await transactionalEntityManager.findOneBy(
//               Listing,
//               { id: listing[i]?.id },
//             );

//             if (!existingListing) {
//               const listingObj = {
//                 id: listing[i]?.id,
//                 name: listing[i]?.name,
//                 description: listing[i]?.description,
//                 externalListingName: listing[i]?.externalListingName,
//                 address: listing[i]?.address,
//                 guests: listing[i]?.personCapacity,
//                 price: listing[i]?.price,
//                 guestsIncluded: listing[i]?.guestsIncluded,
//                 priceForExtraPerson: listing[i]?.priceForExtraPerson,
//                 currencyCode: listing[i]?.currencyCode,
//                 internalListingName: listing[i]?.internalListingName
//                   ? listing[i].internalListingName
//                   : '',
//                 country: listing[i]?.country ? listing[i].country : '',
//                 countryCode: listing[i]?.countryCode
//                   ? listing[i].countryCode
//                   : '',
//                 state: listing[i]?.state ? listing[i].state : '',
//                 city: listing[i]?.city ? listing[i].city : '',
//                 street: listing[i]?.street ? listing[i].street : '',
//                 zipcode: listing[i]?.zipcode ? listing[i].zipcode : '',
//                 lat: listing[i]?.lat ? listing[i].lat : 0,
//                 lng: listing[i]?.lng ? listing[i].lng : 0,
//                 propertyType: listing[i]?.bookingcomPropertyRoomName,
//                 checkInTimeStart: listing[i]?.checkInTimeStart
//                   ? listing[i].checkInTimeStart
//                   : 0,
//                 checkInTimeEnd: listing[i]?.checkInTimeEnd
//                   ? listing[i].checkInTimeEnd
//                   : 0,
//                 checkOutTime: listing[i]?.checkOutTime
//                   ? listing[i].checkOutTime
//                   : 0,
//                 wifiUsername: listing[i]?.wifiUsername
//                   ? listing[i].wifiUsername
//                   : '',
//                 wifiPassword: listing[i]?.wifiPassword
//                   ? listing[i].wifiPassword
//                   : '(NO PASSWORD)',
//                 bookingcomPropertyRoomName: listing[i]
//                   ?.bookingcomPropertyRoomName
//                   ? listing[i].bookingcomPropertyRoomName
//                   : '',
//               };
//               const saveListing = await transactionalEntityManager.save(
//                 Listing,
//                 listingObj,
//               );

//               for (let j = 0; j < listing[i]['listingImages'].length; j++) {
//                 const listingImageObj = {
//                   caption: listing[i]['listingImages'][j].caption,
//                   vrboCaption: listing[i]['listingImages'][j].vrboCaption,
//                   airbnbCaption: listing[i]['listingImages'][j].airbnbCaption,
//                   url: listing[i]['listingImages'][j].url,
//                   sortOrder: listing[i]['listingImages'][j].sortOrder,
//                   listing: saveListing.listingId,
//                 };
//                 await transactionalEntityManager.save(
//                   ListingImage,
//                   listingImageObj,
//                 );
//               }
//             }
//           }
//         },
//       );

//       return { success: true, message: 'Listing synced successfully!' };
//     } catch (error) {
//       console.error('Error syncing listings:', error);
//       throw error;
//     }
//   }

//   //fetch all available listings
//   async getListings() {
//     try {
//       const listingsWithImages = await this.listingRepository
//         .createQueryBuilder('listing')
//         .leftJoinAndSelect('listing.images', 'listingImages')
//         .leftJoinAndSelect('listing.guideBook', 'GuideBook')
//         .getMany();
//       return { success: true, listings: listingsWithImages };
//     } catch (error) {
//       console.log(error);
//       throw error;
//     }
//   }

//   async getListingById(request: Request) {
//     const { listing_id } = request.params;
//     const result = await this.listingRepository
//       .createQueryBuilder('listing')
//       .leftJoinAndSelect('listing.images', 'listingImages')
//       .where('listing.listingId = :id', { id: Number(listing_id) })
//       .getOne();

//     return result;
//   }

//   async getDeviceIdByListingId(listing_id: number) {
//     const listing = await this.listingRepository.findOne({
//       where: { id: listing_id },
//     });
//     if (listing) {
//       const listingLockInfo = await this.listingLockRepository.findOne({
//         where: { listing_id: listing.listingId, status: 1 },
//       });
//       return listingLockInfo?.lock_id;
//     } else {
//       return null;
//     }
//   }
// }
