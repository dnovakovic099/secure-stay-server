import { appDatabase } from "../utils/database.util";
import { ItemSupplyRequest } from "../entity/ItemSupplyRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { UsersService } from "./UsersService";
import { slackMessageService } from "./SlackMessageService";
import { buildItemSupplyRequestSlackMessage, buildItemSupplyRequestUpdateSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { getDiff } from "../helpers/helpers";

export class ItemSupplyRequestService {
    private itemSupplyRequestRepo = appDatabase.getRepository(ItemSupplyRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private usersService = new UsersService();

    async getByProperty(propertyId: number): Promise<{ data: ItemSupplyRequest | null; property: any; }> {
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
            relations: ["client", "propertyInfo"],
        });

        if (!property) {
            throw new Error("Property not found");
        }

        const request = await this.itemSupplyRequestRepo.findOne({
            where: { propertyId },
        });

        return {
            data: request,
            property: this.getPropertyDetails(property),
        };
    }

    async getAll(params: {
        page: number;
        limit: number;
        status?: string[];
        propertyId?: number[];
    }): Promise<{ data: ItemSupplyRequest[]; total: number; page: number; limit: number; }> {
        const { page, limit, status, propertyId } = params;
        const skip = (page - 1) * limit;

        const queryBuilder = this.itemSupplyRequestRepo
            .createQueryBuilder("isr")
            .leftJoinAndSelect("isr.property", "property")
            .leftJoinAndSelect("property.client", "client");

        if (status && status.length > 0) {
            queryBuilder.andWhere("isr.status IN (:...status)", { status });
        }

        if (propertyId && propertyId.length > 0) {
            queryBuilder.andWhere("isr.propertyId IN (:...propertyId)", { propertyId });
        }

        queryBuilder
            .orderBy("isr.createdAt", "DESC")
            .skip(skip)
            .take(limit);

        const [data, total] = await queryBuilder.getManyAndCount();

        return { data, total, page, limit };
    }

    async create(propertyId: number, data: Partial<ItemSupplyRequest>, createdBy?: string, authenticatedUserId?: string): Promise<ItemSupplyRequest> {
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
        });

        if (!property) {
            throw new Error("Property not found");
        }

        let existingRequest = await this.itemSupplyRequestRepo.findOne({
            where: { propertyId },
        });

        let result: ItemSupplyRequest;
        if (existingRequest) {
            const oldRequest = { ...existingRequest };
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            result = await this.itemSupplyRequestRepo.save(existingRequest);

            await this.handleSlackNotification(result, oldRequest, authenticatedUserId);
        } else {
            const request = this.itemSupplyRequestRepo.create({
                ...data,
                propertyId,
                createdBy: createdBy || null,
            });
            result = await this.itemSupplyRequestRepo.save(request);

            await this.handleSlackNotification(result, null, authenticatedUserId);
        }

        return result;
    }

    async update(id: number, data: Partial<ItemSupplyRequest>, updatedBy?: string): Promise<ItemSupplyRequest> {
        const request = await this.itemSupplyRequestRepo.findOne({
            where: { id },
        });

        if (!request) {
            throw new Error("Item supply request not found");
        }

        Object.assign(request, data);
        request.updatedBy = updatedBy || null;

        return await this.itemSupplyRequestRepo.save(request);
    }

    private async handleSlackNotification(request: ItemSupplyRequest, oldRequest: ItemSupplyRequest | null, authenticatedUserId: string) {
        try {
            const entityType = 'ItemSupplyRequest';
            const entityId = request.id;

            const existingMessage = await slackMessageService.getLatestMessageByEntity(entityType, entityId);
            const threadTs = existingMessage?.messageTs;

            if (oldRequest && threadTs) {
                // Threaded update
                const diff = getDiff(oldRequest, request);
                delete (diff as any).updatedAt;
                delete (diff as any).updatedBy;
                delete (diff as any).createdAt;
                delete (diff as any).createdBy;

                if (Object.keys(diff).length > 0) {
                    const slackMsg = buildItemSupplyRequestUpdateSlackMessage(diff, request);
                    await sendSlackMessage(slackMsg, threadTs);
                }
            } else {
                // New submission or fallback to new thread
                let apiKey = '';
                if (authenticatedUserId) {
                    const keyObj = await this.usersService.getApiKey(authenticatedUserId);
                    apiKey = keyObj.apiKey.toString();
                }

                const formLink = `https://securestay.ai/item-supply-request/${request.propertyId}/${apiKey}`;
                const slackMsg = buildItemSupplyRequestSlackMessage(request, formLink);
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
            console.error("Error handling Item Supply Request Slack notification:", error);
        }
    }

    private getPropertyDetails(property: ClientPropertyEntity): any {
        return {
            id: property.id,
            address: property.address,
            internalListingName: (property as any).propertyInfo?.internalListingName || '',
            streetAddress: property.streetAddress,
            unitNumber: property.unitNumber,
            city: property.city,
            state: property.state,
            zipCode: property.zipCode,
            clientName: `${property.client?.firstName || ''} ${property.client?.lastName || ''}`.trim(),
        };
    }
}

export const itemSupplyRequestService = new ItemSupplyRequestService();
