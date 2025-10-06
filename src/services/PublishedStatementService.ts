import { MoreThanOrEqual } from "typeorm";
import { HostAwayClient } from "../client/HostAwayClient";
import { PublishedStatementEntity } from "../entity/PublishedStatements";
import { getPeriodType } from "../helpers/date";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { Request } from "express";

export class PublishedStatementService {
  private publishedStatementRepo = appDatabase.getRepository(
    PublishedStatementEntity
  );
  private hostawayClient = new HostAwayClient();

  async createPublishedStatement(
    data: Partial<PublishedStatementEntity>
  ): Promise<PublishedStatementEntity> {
    const newStatement = this.publishedStatementRepo.create(data);
    return await this.publishedStatementRepo.save(newStatement);
  }

  async getPublishedStatements(
    request?: any
  ): Promise<PublishedStatementEntity[]> {
    try {
      const statements = await this.publishedStatementRepo.find();

      const { year, month, durationType } = request.query;

      const transformedStatements = statements.map((statement) => ({
        ...statement,
        listingMapIds: statement.listingMapIds
          ? JSON.parse(statement.listingMapIds)
          : [],
        url: `https://dashboard.hostaway.com/v3/owner-statements/${statement.statementId}`,
        durationType: getPeriodType(statement.fromDate, statement.toDate),
      }));

      let filteredStatements = transformedStatements;

      if (year) {
        const yearNum = parseInt(year as string);
        filteredStatements = filteredStatements.filter((statement) => {
          const statementYear = parseInt(statement.fromDate.split("-")[0]);
          return statementYear === yearNum;
        });
      }

      if (month) {
        const monthNum = parseInt(month as string);
        filteredStatements = filteredStatements.filter((statement) => {
          const statementMonth = parseInt(statement.fromDate.split("-")[1]);
          return statementMonth === monthNum;
        });
      }

      if (durationType) {
        filteredStatements = filteredStatements.filter(
          (statement) => statement.durationType === durationType.toUpperCase()
        );
      }

      return filteredStatements;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  async fetchPublishedStatementFromHA() {
    const response = await this.hostawayClient.getOwnerStatements();
    if (!response) {
      logger.error("No response from HostAway API for owner statements.");
      return [];
    }
    const publishedStatements = response.filter(
      (statement: any) => statement.status === "new"
    );
    //sort the publishedStatements in desc order by id
    publishedStatements.sort((a: any, b: any) => b.id - a.id);
    return publishedStatements;
  }

  async fetchPublishedStatementByIdFromHA(statementId: number) {
    const response = await this.hostawayClient.getOwnerStatementById(
      statementId
    );
    if (!response) {
      logger.error(
        `No response from HostAway API for owner statement ID ${statementId}.`
      );
      return null;
    }
    return response;
  }

  async savePublishedStatement() {
    const publishedStatements = await this.fetchPublishedStatementFromHA();
    const existingStatements = await this.publishedStatementRepo.find();
    const existingStatementIds = existingStatements.map(
      (statement) => statement.statementId
    );
    for (const statement of publishedStatements) {
      if (!existingStatementIds.includes(statement.id)) {
        logger.info(
          `Processing new published statement with ID ${statement.id}...`
        );

        const statementInfo = await this.fetchPublishedStatementByIdFromHA(
          statement.id
        );

        if (!statementInfo) {
          logger.error(
            `Failed to fetch detailed info for statement ID ${statement.id}. Skipping...`
          );
          continue;
        }
        const { filterParametersJson } = statementInfo;
        if (!filterParametersJson) {
          logger.error(
            `No filterParametersJson found for statement ID ${statement.id}. Skipping...`
          );
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
        logger.info(
          `Published statement with ID ${statement.id} saved successfully.`
        );
      } else {
        logger.info(
          `Published statement with ID ${statement.id} already exists in the database.`
        );
      }
    }
    return;
  }

  async syncPublishedStatements() {
    try {
      logger.info("Starting published statements synchronization...");

      const now = new Date();
      const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);


      const firstDayString = firstDayOfLastMonth.toISOString().split("T")[0];

      const publishedStatements = await this.publishedStatementRepo.find({
        where: {
          toDate: MoreThanOrEqual(firstDayString),
        },
        order: { toDate: "ASC" },
      });

      logger.info(
        `Fetched ${publishedStatements.length} published statements from ${firstDayString} onwards.`
      );

      // TODO: Add sync logic here
      for (const statement of publishedStatements) {
        logger.info(`Synchronizing statement ID ${statement.statementId}...`);
        // Example: Fetch latest details from HostAway and update local record
        const latestDetails = await this.fetchPublishedStatementByIdFromHA(
          statement.statementId
        );
        if (latestDetails) {
          statement.grandTotal = latestDetails.grandTotalAmount;
          statement.updatedAt = new Date();
          statement.updatedBy = "system";
          await this.publishedStatementRepo.save(statement);
          logger.info(`Statement ID ${statement.statementId} synchronized.`);
        } else {
          logger.warn(
            `Could not fetch latest details for statement ID ${statement.statementId}. Skipping update.`
          );
        }
      }
      logger.info("Published statements synchronization completed successfully.");
    } catch (error) {
      logger.error("Error during published statements synchronization:", error);
    }
  }
}
