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

	async createConnectWebView() {
		return this.seamConnect.createConnectWebView();
	}

	//get clientsessiontoken
	async getClientSessionToken() {
		return this.seamConnect.getClientSessionToken();
	}

	//get access token for sifely devices
	async getAccessToken(username: string, password: string) {
		const result = await this.sifelyClient.getaccestoken(username, password);
		if (result?.errcode) {
			throw CustomErrorHandler.validationError(result?.errmsg);
		}

		await this.fetchSifelyLocks(result?.access_token);
		return result;
	}

	private async fetchSifelyLocks(accessToken: string) {
		const date = new Date().valueOf();
		const lockList = await this.sifelyClient.getLockList(accessToken, 1, 1000, date);

		for (const lock of lockList) {
			const count = await this.sifelyLockRepository.count({ where: { lockId: lock.lockId } });

			if (count === 0) {
				const sifelyLock = this.createSifelyLockObject(lock, accessToken);
				await this.sifelyLockRepository.save(sifelyLock);
			}
		}
	}


	private createSifelyLockObject(lockData: any, accessToken: string): SifelyLock {
		const sifelyLock = new SifelyLock();

		sifelyLock.lockId = lockData.lockId;
		sifelyLock.lockName = lockData.lockName;
		sifelyLock.lockAlias = lockData.lockAlias;
		sifelyLock.lockMac = lockData.lockMac;
		sifelyLock.electricQuantity = lockData.electricQuantity;
		sifelyLock.featureValue = lockData.featureValue;
		sifelyLock.hasGateway = lockData.hasGateway;
		sifelyLock.lockData = lockData.lockData;
		sifelyLock.groupId = lockData.groupId;
		sifelyLock.groupName = lockData.groupName;
		sifelyLock.date = lockData.date;
		sifelyLock.accessToken = accessToken;
		sifelyLock.createdAt = new Date();
		sifelyLock.updatedAt = new Date();

		return sifelyLock;
	}


	async getSifelyLocks() {
		return await this.sifelyLockRepository.find({
			where: { status: 1 }, select: {
				id: true,
				lockId: true,
				lockName: true,
				lockAlias: true,
				lockMac: true,
				electricQuantity: true,
			}
		});
	}

	async getSifelyLockInfo(lockId: number) {
		return await this.sifelyLockRepository.findOne({ where: { lockId: lockId } })
	}

	//get device listing
	async getDeviceListing(deviceId: string) {
		const listings =
			await this.listingRepository
				.createQueryBuilder("l")
				.innerJoin(ListingLockInfo, "ll", "l.id = ll.listing_id")
				.leftJoinAndSelect("l.images", "listingImages")
				.where("ll.lock_id = :deviceId", { deviceId })
				.andWhere("ll.status = 1")
				.getOne();

		return listings;
	}

	async saveLockListingInfo(deviceId: string, listingId: number, deviceType: string) {
		if (listingId === null) {
			await this.deactivateLock(deviceId);
			return;
		}

		await this.checkAndAssociateLock(deviceId, listingId, deviceType);
	}

	private async deactivateLock(deviceId: string) {
		const result = await this.listingLockInfoRepository.findOne({ where: { lock_id: deviceId, status: 1 } });

		if (result) {
			result.status = 0;
			result.updated_at = new Date();
			await this.listingLockInfoRepository.save(result);
		}
	}

	private async checkAndAssociateLock(deviceId: string, listingId: number, deviceType: string) {
		const existingLockInfo = await this.listingLockInfoRepository.findOne({ where: { listing_id: listingId, status: 1 } });

		if (existingLockInfo) {
			if (existingLockInfo.lock_id === deviceId && existingLockInfo.status === 1) {
				return;
			} 
			throw CustomErrorHandler.alreadyExists('The selected listing has already been associated with another lock');
		}

		await this.createNewLockInfoTransaction(deviceId, listingId, deviceType);
	}

	private async createNewLockInfoTransaction(deviceId: string, listingId: number, deviceType: string) {
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

	async createCodesForSifelyDevice(accessToken: string, lockId: number, name: string, code: number, timingOption: number, startDate: string, endDate: string) {
		const date = new Date().valueOf();
		const codeList = await this.sifelyClient.getAllPassCode(accessToken, lockId, 1, 1000, date);

		const isExist = codeList.some((code: { keyboardPwdName: string; }) => code?.keyboardPwdName === name);

		if (!isExist) {
			await this.sifelyClient.createPasscode(accessToken, lockId, name, code, timingOption, startDate, endDate);
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

	async sendPassCodes(deviceId: string, deviceType: string, name: string, code: number, access_token: string) {
		switch (deviceType) {
			case 'Seam':
				return await this.createCodesForSeamDevice(deviceId, name, code);
			case 'Sifely':
				// const token = await this.getSifelyLockAccessToken(deviceId);
				return await this.createCodesForSifelyDevice(access_token, Number(deviceId), name, code, 2, null, null);
			default:
				return;
		}
	}

	async deletePassCodes(accessToken: string, lockId: number, keyboardPwdId: number) {
		return await this.sifelyClient.deletePassCode(accessToken, lockId, keyboardPwdId);
	}

}
