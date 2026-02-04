import { appDatabase } from "../utils/database.util";
import { PhotographerRequest } from "../entity/PhotographerRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { UsersService } from "./UsersService";
import { slackMessageService } from "./SlackMessageService";
import { buildPhotographerRequestSlackMessage, buildPhotographerRequestUpdateSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { getDiff } from "../helpers/helpers";

export class PhotographerRequestService {
    private photographerRequestRepo = appDatabase.getRepository(PhotographerRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private usersService = new UsersService();

    async getByProperty(propertyId: number): Promise<PhotographerRequest | null> {
        return this.photographerRequestRepo.findOne({
            where: { propertyId },
            relations: ["property"],
        });
    }

    async getAll(params: {
        page: number;
        limit: number;
        status?: string[];
        propertyId?: number[];
    }): Promise<{ data: PhotographerRequest[]; total: number; page: number; limit: number; }> {
        const { page, limit, status, propertyId } = params;
        const skip = (page - 1) * limit;

        const queryBuilder = this.photographerRequestRepo
            .createQueryBuilder("pr")
            .leftJoinAndSelect("pr.property", "property")
            .leftJoinAndSelect("property.client", "client");

        if (status && status.length > 0) {
            queryBuilder.andWhere("pr.status IN (:...status)", { status });
        }

        if (propertyId && propertyId.length > 0) {
            queryBuilder.andWhere("pr.propertyId IN (:...propertyId)", { propertyId });
        }

        queryBuilder
            .orderBy("pr.createdAt", "DESC")
            .skip(skip)
            .take(limit);

        const [data, total] = await queryBuilder.getManyAndCount();

        return { data, total, page, limit };
    }

    async create(propertyId: number, data: Partial<PhotographerRequest>, createdBy?: string, authenticatedUserId?: string): Promise<PhotographerRequest> {
        // Check if property exists
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
        });

        if (!property) {
            throw new Error("Property not found");
        }

        // Check if request already exists for this property
        let existingRequest = await this.photographerRequestRepo.findOne({
            where: { propertyId },
        });

        let result: PhotographerRequest;
        if (existingRequest) {
            // Update existing request
            const oldRequest = { ...existingRequest };
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            result = await this.photographerRequestRepo.save(existingRequest);

            await this.handleSlackNotification(result, oldRequest, authenticatedUserId);
        } else {
            // Create new request
            const request = this.photographerRequestRepo.create({
                ...data,
                propertyId,
                createdBy: createdBy || null,
            });
            result = await this.photographerRequestRepo.save(request);

            await this.handleSlackNotification(result, null, authenticatedUserId);
        }

        return result;
    }

    async update(id: number, data: Partial<PhotographerRequest>, updatedBy?: string, authenticatedUserId?: string): Promise<PhotographerRequest> {
        const request = await this.photographerRequestRepo.findOne({
            where: { id },
        });

        if (!request) {
            throw new Error("Photographer request not found");
        }

        const oldRequest = { ...request };
        Object.assign(request, data);
        request.updatedBy = updatedBy || null;

        const result = await this.photographerRequestRepo.save(request);
        await this.handleSlackNotification(result, oldRequest, authenticatedUserId);

        return result;
    }

    private async handleSlackNotification(request: PhotographerRequest, oldRequest: PhotographerRequest | null, authenticatedUserId: string) {
        try {
            const entityType = 'PhotographerRequest';
            const entityId = request.id;

            const existingMessage = await slackMessageService.getLatestMessageByEntity(entityType, entityId);
            const threadTs = existingMessage?.messageTs;

            if (oldRequest && threadTs) {
                // Threaded update
                const diff = getDiff(oldRequest, request);
                // Exclude technical fields from diff
                delete (diff as any).updatedAt;
                delete (diff as any).updatedBy;
                delete (diff as any).createdAt;
                delete (diff as any).createdBy;

                if (Object.keys(diff).length > 0) {
                    const slackMsg = buildPhotographerRequestUpdateSlackMessage(diff, request);
                    await sendSlackMessage(slackMsg, threadTs);
                }
            } else {
                // New submission or fallback to new thread
                let apiKey = '';
                if (authenticatedUserId) {
                    const keyObj = await this.usersService.getApiKey(authenticatedUserId);
                    apiKey = keyObj.apiKey.toString();
                }

                const formLink = `https://securestay.ai/photographer-request/${request.propertyId}/${apiKey}`;
                const slackMsg = buildPhotographerRequestSlackMessage(request, formLink);
                const response = await sendSlackMessage(slackMsg);

                if (response?.ok && response?.ts) {
                    await slackMessageService.saveSlackMessageInfo({
                        channel: slackMsg.channel,
                        messageTs: response.ts,
                        threadTs: response.ts,
                        entityType,
                        entityId,
                        originalMessage: JSON.stringify(slackMsg)
                    });
                }
            }
        } catch (error) {
            console.error("Error handling Photographer Request Slack notification:", error);
        }
    }

    async getDistinctOnboardingReps(): Promise<string[]> {
        const results = await this.photographerRequestRepo
            .createQueryBuilder("pr")
            .select("DISTINCT pr.onboardingRep", "onboardingRep")
            .where("pr.onboardingRep IS NOT NULL")
            .andWhere("pr.onboardingRep != ''")
            .getRawMany();

        return results.map((r) => r.onboardingRep).filter(Boolean);
    }

    async getPropertyDetails(propertyId: number): Promise<any> {
        const property = await this.propertyRepo.findOne({
            where: { id: String(propertyId) },
            relations: ["client", "onboarding"],
        });

        if (!property) {
            throw new Error("Property not found");
        }

        return {
            id: property.id,
            address: property.address,
            streetAddress: property.streetAddress,
            unitNumber: property.unitNumber,
            city: property.city,
            state: property.state,
            zipCode: property.zipCode,
            clientName: `${property.client?.firstName || ''} ${property.client?.lastName || ''}`.trim(),
        };
    }
}

export const photographerRequestService = new PhotographerRequestService();
