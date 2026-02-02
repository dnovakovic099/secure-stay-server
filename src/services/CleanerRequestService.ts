import { appDatabase } from "../utils/database.util";
import { CleanerRequest } from "../entity/CleanerRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { UsersService } from "./UsersService";
import { slackMessageService } from "./SlackMessageService";
import { buildCleanerRequestSlackMessage, buildCleanerRequestUpdateSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { getDiff } from "../helpers/helpers";

export class CleanerRequestService {
    private cleanerRequestRepo = appDatabase.getRepository(CleanerRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private usersService = new UsersService();

    async getByProperty(propertyId: number): Promise<{ data: CleanerRequest | null; property: any; }> {
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
            relations: ["client"],
        });

        if (!property) {
            throw new Error("Property not found");
        }

        const request = await this.cleanerRequestRepo.findOne({
            where: { propertyId },
        });

        return {
            data: request,
            property: this.getPropertyDetails(property),
        };
    }

    async create(propertyId: number, data: Partial<CleanerRequest>, createdBy?: string, authenticatedUserId?: string): Promise<CleanerRequest> {
        // Check if property exists
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
        });

        if (!property) {
            throw new Error("Property not found");
        }

        // Check if request already exists for this property
        let existingRequest = await this.cleanerRequestRepo.findOne({
            where: { propertyId },
        });

        let result: CleanerRequest;
        if (existingRequest) {
            // Update existing request
            const oldRequest = { ...existingRequest };
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            result = await this.cleanerRequestRepo.save(existingRequest);

            await this.handleSlackNotification(result, oldRequest, authenticatedUserId);
        } else {
            // Create new request
            const request = this.cleanerRequestRepo.create({
                ...data,
                propertyId,
                createdBy: createdBy || null,
            });
            result = await this.cleanerRequestRepo.save(request);

            await this.handleSlackNotification(result, null, authenticatedUserId);
        }

        return result;
    }

    async update(id: number, data: Partial<CleanerRequest>, updatedBy?: string, authenticatedUserId?: string): Promise<CleanerRequest> {
        const request = await this.cleanerRequestRepo.findOne({
            where: { id },
        });

        if (!request) {
            throw new Error("Cleaner request not found");
        }

        const oldRequest = { ...request };
        Object.assign(request, data);
        request.updatedBy = updatedBy || null;

        const result = await this.cleanerRequestRepo.save(request);
        await this.handleSlackNotification(result, oldRequest, authenticatedUserId);

        return result;
    }

    private async handleSlackNotification(request: CleanerRequest, oldRequest: CleanerRequest | null, authenticatedUserId: string) {
        try {
            const entityType = 'CleanerRequest';
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
                    const slackMsg = buildCleanerRequestUpdateSlackMessage(diff, request);
                    await sendSlackMessage(slackMsg, threadTs);
                }
            } else {
                // New submission or fallback to new thread
                let apiKey = '';
                if (authenticatedUserId) {
                    const keyObj = await this.usersService.getApiKey(authenticatedUserId);
                    apiKey = keyObj.apiKey.toString();
                }

                const formLink = `https://securestay.ai/cleaner-request/${request.propertyId}/${apiKey}`;
                const slackMsg = buildCleanerRequestSlackMessage(request, formLink);
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
            console.error("Error handling Cleaner Request Slack notification:", error);
        }
    }

    private getPropertyDetails(property: ClientPropertyEntity): any {
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

export const cleanerRequestService = new CleanerRequestService();

