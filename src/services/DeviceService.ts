import { Request } from "express";
import { SeamConnect } from "../client/SeamConnect";
import { SifelyClient } from "../client/SifelyClient";
import { appDatabase } from "../utils/database.util";
import { ListingLockInfo } from "../entity/ListingLock";
import { Listing } from "../entity/Listing";
import { EntityManager, In, Not } from "typeorm";
import CustomErrorHandler from "../middleware/customError.middleware";

export class DeviceService {
  private seamConnect = new SeamConnect();
  private sifelyClient = new SifelyClient();
  private listingLockInfoRepository = appDatabase.getRepository(ListingLockInfo);
  private listingRepository = appDatabase.getRepository(Listing);

  async getDevicesInfo() {
    return this.seamConnect.getDevicesData();
  }

  async getConnectedList() {
    return this.seamConnect.getDevicesConnectedList();
  }

  //get device detail
  async getDevicesDetaildata(request: Request) {
    const deviec_id = String(request.body.device_id);
    return this.seamConnect.getDevicesDetails(deviec_id);
  }

  //lock Device
  async lockDevice(request: Request) {
    const deviec_id = String(request.body.device_id);
    return this.seamConnect.lockDeviceData(deviec_id);
  }

  //unloack Device
  async unlockDevice(request: Request) {
    const deviec_id = String(request.body.device_id);
    return this.seamConnect.unlockDeviceData(deviec_id);
  }

  //get clientsessiontoken
  async getClientSessionToken() {
    return this.seamConnect.getClientSessionToken();
  }

  //get access token for sifely devices
  async getAccessToken(request: Request) {
    const { username, password } = request.body;
    return this.sifelyClient.getaccestoken(username, password);
  }

  //get sifely locks
  async getSifelyLocks(request: Request) {
    const { access_token, pageNo, pageSize } = request.body;
    //date in milliseconds
    const date = new Date().valueOf();
    return this.sifelyClient.getLockList(access_token, pageNo, pageSize, date);
  }

  //get sifely lock info
  async getSifelyLockInfo(request: Request) {
    const { access_token, lockId } = request.body;
    //date in milliseconds
    const date = new Date().valueOf();
    return this.sifelyClient.getLockInfo(access_token, lockId, date);
  }

  //get device listing
  async getDeviceListings(request: Request) {
    const { device_id } = request.params;
    const listings = await this.listingRepository
      .createQueryBuilder("l")
      .innerJoin(ListingLockInfo, "ll", "l.listing_id = ll.listing_id")
      .leftJoinAndSelect("l.images", "listingImages")
      .where("ll.lock_id = :device_id", { device_id })
      .andWhere("ll.status = 1")
      .getMany();

    return listings;
  }

  async saveLockListingInfo(request: Request) {
    try {
      const { device_id, listing_id } = request.body;      

      //find the device listing_id if exists 
      const result = await this.listingLockInfoRepository.findOne({ where: { listing_id: listing_id } })
      if(result){
        if (result.lock_id == device_id && result.status == 1) {
          return {
            success: true,
            message: "Device listing info saved successfully",
          };
        }else{
          return CustomErrorHandler.validationError('The selected listing has been already associated with other lock')
        }
      }

      await appDatabase.transaction(
        async (transactionalEntityManager: EntityManager) => {
          //update the listing_id status to 0
          await transactionalEntityManager.update(ListingLockInfo, { lock_id: device_id }, { status: 0 })

          const listingLockInfo = new ListingLockInfo()
          listingLockInfo.lock_id = device_id
          listingLockInfo.listing_id = listing_id
          listingLockInfo.created_at = new Date()
          listingLockInfo.updated_at = new Date()
          await transactionalEntityManager.save(listingLockInfo) 
        }
      );

      return {
        success: true,
        message: "Device listing info saved successfully!",
      };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}
