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
	async lockDevice(deviceId: string) {
		return this.seamConnect.lockDeviceData(deviceId);
	}

	//unloack Device
	async unlockDevice(deviceId: string) {
		return this.seamConnect.unlockDeviceData(deviceId);
	}

	//get clientsessiontoken
	async getClientSessionToken() {
		return this.seamConnect.getClientSessionToken();
	}

	//get access token for sifely devices
	async getAccessToken(username: string, password: string) {

		const result = await this.sifelyClient.getaccestoken(username, password);
		if (result?.errcode) {
			return CustomErrorHandler.validationError(result.errmsg);
		}

		return { success: true, message: 'Authenticated successfully', data: result };
	}

	async getSifelyLocks(accessToken: string, pageNo: number, pageSize: number) {
		//date in milliseconds
		const date = new Date().valueOf();
		return this.sifelyClient.getLockList(accessToken, pageNo, pageSize, date);
	}

	async getSifelyLockInfo(accessToken: string, lockId: string) {
		//date in milliseconds
		const date = new Date().valueOf();
		return this.sifelyClient.getLockInfo(accessToken, lockId, date);
	}

	//get device listing
	async getDeviceListing(deviceId: string) {
		const listings =
			await this.listingRepository
				.createQueryBuilder("l")
				.innerJoin(ListingLockInfo, "ll", "l.listing_id = ll.listing_id")
				.leftJoinAndSelect("l.images", "listingImages")
				.where("ll.lock_id = :deviceId", { deviceId })
				.andWhere("ll.status = 1")
				.getMany();

		return listings;
	}

	async saveLockListingInfo(deviceId: string, listingId: number, deviceType: string) {
		try {

			if (listingId == null) {

				const result = await this.listingLockInfoRepository.findOne({ where: { lock_id: deviceId, status: 1 } });
				if (result) {
					result.status = 0;
					result.updated_at = new Date();
					await this.listingLockInfoRepository.save(result);
				}

				return {
					success: true,
					message: "Device listing info saved successfully",
				};
			}

			//find the device listing_id if exists
			const result = await this.listingLockInfoRepository.findOne({ where: { listing_id: listingId, status: 1 } });

			if (result) {
				if (result.lock_id == deviceId && result.status == 1) {
					return {
						success: true,
						message: "Device listing info saved successfully",
					};
				} else {
					return CustomErrorHandler.validationError(
						"The selected listing has been already associated with other lock"
					);
				}
			}

			await appDatabase.transaction(async (transactionalEntityManager: EntityManager) => {

				await transactionalEntityManager.update(ListingLockInfo, { lock_id: deviceId }, { status: 0 });

				const listingLockInfo = new ListingLockInfo();
				listingLockInfo.lock_id = deviceId;
				listingLockInfo.listing_id = listingId;
				listingLockInfo.type = deviceType;
				listingLockInfo.created_at = new Date();
				listingLockInfo.updated_at = new Date();

				await transactionalEntityManager.save(listingLockInfo);

			});

			return {
				success: true,
				message: "Device listing info saved successfully!",
			};

		}
		catch (error) {
			throw error;
		}
	}

	async createCodesForSeamDevice(device_id: string, name: string, code: number) {
		return await this.seamConnect.createAccessCodes(device_id, name, code);
	}

	async getCodesForSeamDevice(device_id: string, name: string, code: number) {
		return await this.seamConnect.getAccessCodes(device_id, name, code);
	}

}
