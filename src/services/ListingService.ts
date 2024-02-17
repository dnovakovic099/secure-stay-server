import { HostAwayClient } from "../client/HostAwayClient";
import { Listing } from "../entity/Listing";
import { ListingImage } from "../entity/ListingImage";
import { ListingLockInfo } from "../entity/ListingLock";
import { appDatabase } from "../utils/database.util";
import { Request } from "express";

export class ListingService {
  private hostAwayClient = new HostAwayClient();
  private listingRepository = appDatabase.getRepository(Listing);
  private listingLockInfoRepository =
    appDatabase.getRepository(ListingLockInfo);

  //fetch listings from hostaway client and save in our database if not present
  async syncHostawayListing() {
    const listing = await this.hostAwayClient.getListing();

    try {
      await appDatabase.manager.transaction(
        async (transactionalEntityManager) => {
          for (let i = 0; i < listing.length; i++) {
            const existingListing = await transactionalEntityManager.findOneBy(
              Listing,
              { id: listing[i].id }
            );

            if (!existingListing) {
              const listingObj = {
                id: listing[i].id,
                name: listing[i].name,
                externalListingName: listing[i].externalListingName,
                address: listing[i].address,
                price: listing[i].price,
                guestsIncluded: listing[i].guestsIncluded,
                priceForExtraPerson: listing[i].priceForExtraPerson,
                currencyCode: listing[i].currencyCode,
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

  async saveLockListingInfo(request: Request) {
    try {
      let obj = {
        ...request.body,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const isExists = await this.listingLockInfoRepository.findOneBy({
        lock_id: request.body.lock_id,
        listing_id: request.body.listing_id,
      });
      if (!isExists) {
        const result = await this.listingLockInfoRepository.save(obj);
        return { success: true,message:'Device listing info saved successfully!', result };
      } else {
        return { success: false, message: "Device with the same listing already exists!" };
      }
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}
