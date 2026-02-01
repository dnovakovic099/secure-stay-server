import { appDatabase } from "../utils/database.util";
import { CleanerRequest } from "../entity/CleanerRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";

export class CleanerRequestService {
    private cleanerRequestRepo = appDatabase.getRepository(CleanerRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);

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

    async create(propertyId: number, data: Partial<CleanerRequest>, createdBy?: string): Promise<CleanerRequest> {
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

        if (existingRequest) {
            // Update existing request
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            return this.cleanerRequestRepo.save(existingRequest);
        }

        // Create new request
        const request = this.cleanerRequestRepo.create({
            ...data,
            propertyId,
            createdBy: createdBy || null,
        });

        return this.cleanerRequestRepo.save(request);
    }

    async update(id: number, data: Partial<CleanerRequest>, updatedBy?: string): Promise<CleanerRequest> {
        const request = await this.cleanerRequestRepo.findOne({
            where: { id },
        });

        if (!request) {
            throw new Error("Cleaner request not found");
        }

        Object.assign(request, data);
        request.updatedBy = updatedBy || null;

        return this.cleanerRequestRepo.save(request);
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

