import { PublishedStatementEntity } from "../entity/PublishedStatements";
import { appDatabase } from "../utils/database.util";

export class PublishedStatementService {
    private publishedStatementRepo = appDatabase.getRepository(PublishedStatementEntity);

    async createPublishedStatement(data: Partial<PublishedStatementEntity>): Promise<PublishedStatementEntity> {
        const newStatement = this.publishedStatementRepo.create(data);
        return await this.publishedStatementRepo.save(newStatement);
    }

    async getPublishedStatements(): Promise<PublishedStatementEntity[]> {
        return await this.publishedStatementRepo.find();
    }
}