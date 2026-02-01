import { appDatabase } from "../utils/database.util";
import { PhotographerRequest } from "../entity/PhotographerRequest";
import { ClientPropertyEntity } from "../entity/ClientProperty";

export class PhotographerRequestService {
    private photographerRequestRepo = appDatabase.getRepository(PhotographerRequest);
    private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);

    async getByProperty(propertyId: number): Promise<PhotographerRequest | null> {
        return this.photographerRequestRepo.findOne({
            where: { propertyId },
            relations: ["property"],
        });
    }

    async create(propertyId: number, data: Partial<PhotographerRequest>, createdBy?: string): Promise<PhotographerRequest> {
        // Verify property exists
        const property = await this.propertyRepo.findOne({ where: { id: String(propertyId) } });
        if (!property) {
            throw new Error("Property not found");
        }

        // Check if a request already exists for this property
        const existingRequest = await this.photographerRequestRepo.findOne({
            where: { propertyId },
        });

        if (existingRequest) {
            // Update existing request
            Object.assign(existingRequest, data);
            existingRequest.updatedBy = createdBy || null;
            return this.photographerRequestRepo.save(existingRequest);
        }

        // Create new request
        const photographerRequest = this.photographerRequestRepo.create({
            ...data,
            propertyId,
            createdBy: createdBy || null,
        });

        return this.photographerRequestRepo.save(photographerRequest);
    }

    async update(id: number, data: Partial<PhotographerRequest>, updatedBy?: string): Promise<PhotographerRequest> {
        const existingRequest = await this.photographerRequestRepo.findOne({
            where: { id },
        });

        if (!existingRequest) {
            throw new Error("Photographer request not found");
        }

        Object.assign(existingRequest, data);
        existingRequest.updatedBy = updatedBy || null;

        return this.photographerRequestRepo.save(existingRequest);
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
