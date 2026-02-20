import { appDatabase } from "../utils/database.util";
import { MaintenanceFormRequest } from "../entity/MaintenanceFormRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { UsersService } from "./UsersService";
import { slackMessageService } from "./SlackMessageService";
import { buildMaintenanceFormRequestSlackMessage, buildMaintenanceFormRequestUpdateSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { getDiff } from "../helpers/helpers";

export class MaintenanceFormRequestService {
    private maintenanceFormRequestRepo = appDatabase.getRepository(MaintenanceFormRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
    private usersService = new UsersService();

    async getByProperty(propertyId: number): Promise<{ data: MaintenanceFormRequest | null; property: any; }> {
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
            relations: ["client", "propertyInfo"],
        });

        if (!property) {
            throw new Error("Property not found");
        }

        const request = await this.maintenanceFormRequestRepo.findOne({
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
    }): Promise<{ data: MaintenanceFormRequest[]; total: number; page: number; limit: number; }> {
        const { page, limit, status, propertyId } = params;
        const skip = (page - 1) * limit;

        const queryBuilder = this.maintenanceFormRequestRepo
            .createQueryBuilder("mfr")
            .leftJoinAndSelect("mfr.property", "property")
            .leftJoinAndSelect("property.client", "client");

        if (status && status.length > 0) {
            queryBuilder.andWhere("mfr.status IN (:...status)", { status });
        }

        if (propertyId && propertyId.length > 0) {
            queryBuilder.andWhere("mfr.propertyId IN (:...propertyId)", { propertyId });
        }

        queryBuilder
            .orderBy("mfr.createdAt", "DESC")
            .skip(skip)
            .take(limit);

        const [data, total] = await queryBuilder.getManyAndCount();

        return { data, total, page, limit };
    }

    async create(propertyId: number, data: Partial<MaintenanceFormRequest>, createdBy?: string, authenticatedUserId?: string): Promise<MaintenanceFormRequest> {
        const property = await this.propertyRepo.findOne({
            where: { id: propertyId.toString() },
        });

        if (!property) {
            throw new Error("Property not found");
        }

        let existingRequest = await this.maintenanceFormRequestRepo.findOne({
            where: { propertyId },
        });

        let result: MaintenanceFormRequest;
        if (existingRequest) {
            const oldRequest = { ...existingRequest };
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            result = await this.maintenanceFormRequestRepo.save(existingRequest);

            await this.handleSlackNotification(result, oldRequest, authenticatedUserId);
        } else {
            const request = this.maintenanceFormRequestRepo.create({
                ...data,
                propertyId,
                createdBy: createdBy || null,
            });
            result = await this.maintenanceFormRequestRepo.save(request);

            await this.handleSlackNotification(result, null, authenticatedUserId);
        }

        return result;
    }

    async update(id: number, data: Partial<MaintenanceFormRequest>, updatedBy?: string): Promise<MaintenanceFormRequest> {
        const request = await this.maintenanceFormRequestRepo.findOne({
            where: { id },
        });

        if (!request) {
            throw new Error("Maintenance form request not found");
        }

        Object.assign(request, data);
        request.updatedBy = updatedBy || null;

        return await this.maintenanceFormRequestRepo.save(request);
    }

    private async handleSlackNotification(request: MaintenanceFormRequest, oldRequest: MaintenanceFormRequest | null, authenticatedUserId: string) {
        try {
            const entityType = 'MaintenanceFormRequest';
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
                    const slackMsg = buildMaintenanceFormRequestUpdateSlackMessage(diff, request);
                    await sendSlackMessage(slackMsg, threadTs);
                }
            } else {
                // New submission or fallback to new thread
                let apiKey = '';
                if (authenticatedUserId) {
                    const keyObj = await this.usersService.getApiKey(authenticatedUserId);
                    apiKey = keyObj.apiKey.toString();
                }

                const formLink = `https://securestay.ai/maintenance-request/${request.propertyId}/${apiKey}`;
                const slackMsg = buildMaintenanceFormRequestSlackMessage(request, formLink);
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
            console.error("Error handling Maintenance Form Request Slack notification:", error);
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

export const maintenanceFormRequestService = new MaintenanceFormRequestService();
