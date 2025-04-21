import { appDatabase } from "../utils/database.util";
import { PartnershipInfoEntity } from "../entity/PartnershipInfo";

export class PartnershipInfoService {
    private partnershipInfoRepo = appDatabase.getRepository(PartnershipInfoEntity);

    async savePartnershipInfo(body: Partial<PartnershipInfoEntity>, userId: string) {
        //check if data exists or not for the listingId
        const existingData = await this.partnershipInfoRepo.findOne({ where: { listingId: body.listingId } });
        if (existingData) {
            return this.updatePartnershipInfo(existingData, body, userId);
        }
        return this.createPartnershipInfo(body, userId);
    }

    private async createPartnershipInfo(body: Partial<PartnershipInfoEntity>, userId: string) {
        const newData = new PartnershipInfoEntity();
        newData.listingId = body.listingId;
        newData.totalEarned = body.totalEarned;
        newData.pendingCommission = body.pendingCommission;
        newData.activeReferral = body.activeReferral;
        newData.yearlyProjection = body.yearlyProjection;
        newData.createdBy = userId;
        return await this.partnershipInfoRepo.save(newData);
    }

    private async updatePartnershipInfo(existingData: Partial<PartnershipInfoEntity>, body: Partial<PartnershipInfoEntity>, userId: string) {
        existingData.totalEarned = body.totalEarned;
        existingData.pendingCommission = body.pendingCommission;
        existingData.activeReferral = body.activeReferral;
        existingData.yearlyProjection = body.yearlyProjection;
        existingData.updatedBy = userId;
        return await this.partnershipInfoRepo.save(existingData);
    }

    async getPartnershipInfo(listingId: number) {
        if (listingId) {
            return this.partnershipInfoRepo.findOne({ where: { listingId } });
        }
        return this.partnershipInfoRepo.find();
    }

}
