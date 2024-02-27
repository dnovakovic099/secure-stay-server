import { EntityManager, In, Not } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { Listing } from "../entity/Listing";
import { ListingImage } from "../entity/ListingImage";
import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ListingLockInfo } from "../entity/ListingLock";

export class ListingService {
  private hostAwayClient = new HostAwayClient();
  private listingRepository = appDatabase.getRepository(Listing);
  private listingLockRepository = appDatabase.getRepository(ListingLockInfo);

  //fetch listings from hostaway client and save in our database if not present
  async syncHostawayListing() {
    const listing = await this.hostAwayClient.getListing();
    try {
      await appDatabase.manager.transaction(
        async (transactionalEntityManager) => {
          for (let i = 0; i < listing.length; i++) {
            const existingListing = await transactionalEntityManager.findOneBy(
              Listing,
              { id: listing[i]?.id }
            );

            if (!existingListing) {
              const listingObj = {
                id: listing[i]?.id,
                name: listing[i]?.name,
                externalListingName: listing[i]?.externalListingName,
                address: listing[i]?.address,
                price: listing[i]?.price,
                guestsIncluded: listing[i]?.guestsIncluded,
                priceForExtraPerson: listing[i]?.priceForExtraPerson,
                currencyCode: listing[i]?.currencyCode,
                internalListingName: listing[i]?.internalListingName ? listing[i].internalListingName : "",
                country: listing[i]?.country ? listing[i].country : "",
                countryCode: listing[i]?.countryCode ? listing[i].countryCode : "",
                state: listing[i]?.state ? listing[i].state : "",
                city: listing[i]?.city ? listing[i].city : "",
                street: listing[i]?.street ? listing[i].street : "",
                zipcode: listing[i]?.zipcode ? listing[i].zipcode : "",
                lat: listing[i]?.lat ? listing[i].lat : 0,
                lng: listing[i]?.lng ? listing[i].lng : 0,
                checkInTimeStart: listing[i]?.checkInTimeStart ? listing[i].checkInTimeStart : 0,
                checkInTimeEnd: listing[i]?.checkInTimeEnd ? listing[i].checkInTimeEnd : 0,
                checkOutTime: listing[i]?.checkOutTime ? listing[i].checkOutTime : 0,
                wifiUsername: listing[i]?.wifiUsername ? listing[i].wifiUsername : "",
                wifiPassword: listing[i]?.wifiPassword ? listing[i].wifiPassword : "",
                bookingcomPropertyRoomName: listing[i]?.bookingcomPropertyRoomName ? listing[i].bookingcomPropertyRoomName : "",
              };
              const saveListing = await transactionalEntityManager.save(
                Listing,
                listingObj
              );

              for (let j = 0; j < listing[i]["listingImages"].length; j++) {
                const listingImageObj = {
                  caption: listing[i]["listingImages"][j].caption,
                  vrboCaption: listing[i]["listingImages"][j].vrboCaption,
                  airbnbCaption: listing[i]["listingImages"][j].airbnbCaption,
                  url: listing[i]["listingImages"][j].url,
                  sortOrder: listing[i]["listingImages"][j].sortOrder,
                  listing: saveListing.listingId,
                };
                await transactionalEntityManager.save(
                  ListingImage,
                  listingImageObj
                );
              }
            }
          }
        }
      );

      return { success: true, message: "Listing synced successfully!" };
    } catch (error) {
      console.error("Error syncing listings:", error);
      throw error;
    }
  }

  //fetch all available listings
  async getListings() {
    try {
      const listingsWithImages = await this.listingRepository
        .createQueryBuilder("listing")
        .leftJoinAndSelect("listing.images", "listingImages")
        .getMany();
      return { success: true, listings: listingsWithImages };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  async getListingById(request: Request) {
    const { listing_id } = request.params;
    const result = await this.listingRepository.find({
      where: { listingId: Number(listing_id) },
    });
    return result;
  }

  async getLockInfoAssociatedWithListing(listing_id: number) {
    const listing = await this.listingRepository.findOne({ where: { id: listing_id } });

    if (listing) {
      const listingLockInfo = await this.listingLockRepository.findOne({ where: { listing_id: listing.listingId, status: 1 } });
      return { device_id: listingLockInfo?.lock_id, device_type: listingLockInfo?.type };
    } else {
      return null;
    }
  }

  
}
