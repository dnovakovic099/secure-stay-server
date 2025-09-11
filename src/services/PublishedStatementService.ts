import { HostAwayClient } from "../client/HostAwayClient";
import { PublishedStatementEntity } from "../entity/PublishedStatements";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";

export class PublishedStatementService {
    private publishedStatementRepo = appDatabase.getRepository(PublishedStatementEntity);
    private hostawayClient = new HostAwayClient();

    async createPublishedStatement(data: Partial<PublishedStatementEntity>): Promise<PublishedStatementEntity> {
        const newStatement = this.publishedStatementRepo.create(data);
        return await this.publishedStatementRepo.save(newStatement);
    }

    async getPublishedStatements(): Promise<PublishedStatementEntity[]> {
        return await this.publishedStatementRepo.find();
    }

    async fetchPublishedStatementFromHA() {
        const response = await this.hostawayClient.getOwnerStatements();
        if (!response) {
            logger.error("No response from HostAway API for owner statements.");
            return [];
        }
        const publishedStatements = response.filter((statement: any) => statement.status === "new");
        return publishedStatements;
    }

    async fetchPublishedStatementByIdFromHA(statementId: number) {
        const response = await this.hostawayClient.getOwnerStatementById(statementId);
        if (!response) {
            logger.error(`No response from HostAway API for owner statement ID ${statementId}.`);
            return null;
        }
        return response;
    }

    async savePublishedStatement() {
        const publishedStatements = await this.fetchPublishedStatementFromHA();
        const existingStatements = await this.getPublishedStatements();
        const existingStatementIds = existingStatements.map(statement => statement.statementId);
        for (const statement of publishedStatements) {
            if (!existingStatementIds.includes(statement.id)) {
                const statementInfo = await this.fetchPublishedStatementByIdFromHA(statement.id);
                if (!statementInfo) {
                    logger.error(`Failed to fetch detailed info for statement ID ${statement.id}. Skipping...`);
                    continue;
                }
                const { filterParametersJson } = statementInfo;
                if (!filterParametersJson) {
                    logger.error(`No filterParametersJson found for statement ID ${statement.id}. Skipping...`);
                    continue;
                }

                const newStatementData: Partial<PublishedStatementEntity> = {
                    fromDate: filterParametersJson.fromDate,
                    toDate: filterParametersJson.toDate,
                    dateType: filterParametersJson.dateType,
                    listingMapIds: JSON.stringify(filterParametersJson.listingMapIds),
                    statementName: statementInfo.statementName,
                    statementId: statementInfo.id,
                    durationType: statementInfo.durationType,
                    grandTotal: statementInfo.grandTotalAmount,
                    propertyOwnerName: statementInfo.propertyOwnerName,
                    propertyOwnerPhone: statementInfo.propertyOwnerPhone,
                    createdBy: "system",
                };

                await this.createPublishedStatement(newStatementData);
            } else {
                logger.info(`Published statement with ID ${statement.id} already exists in the database.`);
            }
        }
        return;
    }
}