import { appDatabase } from "../utils/database.util";
import { OwnerInfoEntity } from "../entity/OwnerInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Not } from "typeorm";

export class OwnerInfoService {
    private ownerInfoRepo = appDatabase.getRepository(OwnerInfoEntity);

    async getOwnerInfo(listingId?: any) {
        const query = this.ownerInfoRepo
            .createQueryBuilder("owner")
            .select("DISTINCT owner.ownerName", "ownerName") // Select unique ownerName
            .where("owner.ownerName IS NOT NULL AND owner.ownerName != ''");

        if (listingId) {
            query.andWhere("owner.listingId = :listingId", { listingId: Number(listingId) });
        }

        const ownerInfo = await query.getRawMany(); // Returns raw data with unique owner names

        if (ownerInfo.length === 0) {
            throw new CustomErrorHandler(404, "Owner info not found");
        }

        return ownerInfo;
    }


}
