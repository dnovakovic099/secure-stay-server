import { Request } from "express";
import { SeamConnect } from "../client/SeamConnect";
import { SifelyClient } from "../client/SifelyClient";
import { appDatabase } from "../utils/database.util";
import { ListingLockInfo } from "../entity/ListingLock";
import { Listing } from "../entity/Listing";
import { EntityManager, In, Not } from "typeorm";
import CustomErrorHandler from "../middleware/customError.middleware";
import { SifelyLock } from "../entity/SifelyLock";

export class DeviceService {

	private seamConnect = new SeamConnect();
	private sifelyClient = new SifelyClient();

	private listingLockInfoRepository = appDatabase.getRepository(ListingLockInfo);
	private listingRepository = appDatabase.getRepository(Listing);
	private sifelyLockRepository = appDatabase.getRepository(SifelyLock);

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

		const date = new Date().valueOf();

		//fetch the sifely locks from the sifelyClient and save in our database
		const lockList = await this.sifelyClient.getLockList(result?.access_token, 1, 1000, date);

		for (let i = 0; i < lockList?.length; i++) {
			const count = await this.sifelyLockRepository.count({ where: { lockId: lockList[i]?.lockId } });

			if (count == 0) {
				const sifelyLock = new SifelyLock();

				sifelyLock.lockId = lockList[i]?.lockId;
				sifelyLock.lockName = lockList[i]?.lockName;
				sifelyLock.lockAlias = lockList[i]?.lockAlias;
				sifelyLock.lockMac = lockList[i]?.lockMac;
				sifelyLock.electricQuantity = lockList[i]?.electricQuantity;
				sifelyLock.featureValue = lockList[i]?.featureValue;
				sifelyLock.hasGateway = lockList[i]?.hasGateway;
				sifelyLock.lockData = lockList[i]?.lockData;
				sifelyLock.groupId = lockList[i]?.groupId;
				sifelyLock.groupName = lockList[i]?.groupName;
				sifelyLock.date = lockList[i]?.date;
				sifelyLock.accessToken = result?.access_token;
				sifelyLock.createdAt = new Date();
				sifelyLock.updatedAt = new Date();

				await this.sifelyLockRepository.save(sifelyLock);
			}

		}

		return { success: true, message: 'Authenticated successfully', data: result };
	}

	async getSifelyLocks() {
		return await this.sifelyLockRepository.find({
			where: { status: 1 }, select: {
				id: true,
				lockId: true,
				lockName: true,
				lockAlias: true,
				lockMac: true,
				electricQuantity: true
			}
		})
	}

	async getSifelyLockInfo(accessToken: string, lockId: number) {
		return await this.sifelyLockRepository.findOne({ where: { lockId: lockId } })
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
			if (listingId === null) {
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

			const existingLockInfo = await this.listingLockInfoRepository.findOne({ where: { listing_id: listingId, status: 1 } });

			if (existingLockInfo) {
				if (existingLockInfo.lock_id === deviceId && existingLockInfo.status === 1) {
					return {
						success: true,
						message: "Device listing info saved successfully",
					};
				} else {
					throw new Error("The selected listing has already been associated with another lock");
				}
			}

			await appDatabase.transaction(async (transactionalEntityManager: EntityManager) => {
				await transactionalEntityManager.update(ListingLockInfo, { lock_id: deviceId }, { status: 0 });

				const newLockInfo = new ListingLockInfo();
				newLockInfo.lock_id = deviceId;
				newLockInfo.listing_id = listingId;
				newLockInfo.type = deviceType;
				newLockInfo.created_at = new Date();
				newLockInfo.updated_at = new Date();

				await transactionalEntityManager.save(newLockInfo);
			});

			return {
				success: true,
				message: "Device listing info saved successfully!",
			};
		} catch (error) {
			console.error('Error saving lock listing info:', error);
			throw error;
		}
	}


	async createCodesForSeamDevice(device_id: string, name: string, code: number) {
		const codeList = await this.seamConnect.getAccessCodes(device_id);
		
		const isExist = codeList.some((code: { name: string; }) => code.name === name);

		if (!isExist) {
			await this.seamConnect.createAccessCodes(device_id, name, code);
			console.log(`Code created for device:${device_id}`);
		}
	}

	async getCodesForSeamDevice(device_id: string) {
		return await this.seamConnect.getAccessCodes(device_id);
	}

	async createCodesForSifelyDevice(accessToken: string, lockId: number, name: string, code: number) {
		const date = new Date().valueOf();
		const codeList = await this.sifelyClient.getAllPassCode(accessToken, lockId, 1, 1000, date);

		const isExist = codeList.some((code: { keyboardPwdName: string; }) => code?.keyboardPwdName === name);

		if (!isExist) {
			await this.sifelyClient.createPasscode(accessToken, lockId, name, code);
			console.log(`Code created for device:${lockId}`);
		}
	}

	async getCodesForSifelyDevice(accessToken: string, lockId: number) {
		const date = new Date().valueOf();
		return await this.sifelyClient.getAllPassCode(accessToken, lockId, 1, 1000, date);
	}

	async getSifelyLockAccessToken(lockId: string) {
		const token = await this.sifelyLockRepository.findOne({ where: { lockId: Number(lockId) }, select: { accessToken: true } });
		return token?.accessToken || null;
	}

	async sendPassCodes(deviceId: string, deviceType: string, name: string, code: number) {
		switch (deviceType) {
			case 'Seam':
				return await this.createCodesForSeamDevice(deviceId, name, code);
			case 'Sifely':
				const token = await this.getSifelyLockAccessToken(deviceId);
				return await this.createCodesForSifelyDevice(token, Number(deviceId), name, code);
			default:
				return;
		}
	}

}
