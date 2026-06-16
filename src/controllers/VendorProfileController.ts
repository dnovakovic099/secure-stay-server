import { NextFunction, Request, Response } from "express";
import { VendorProfileService } from "../services/VendorProfileService";

interface CustomRequest extends Request {
    user?: any;
}

export class VendorProfileController {
    async getVendorProfiles(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.getVendorProfiles(request.query, request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getVendorProfile(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.getVendorProfile(Number(request.params.id), request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getActiveCleanerAssignments(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const listingIds = Array.isArray(request.query.listingIds)
                ? request.query.listingIds
                : String(request.query.listingIds || "").split(",");
            const service = new VendorProfileService();
            const result = await service.getActiveCleanerAssignmentsByListing(listingIds as string[], request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async updateListingCleanerManagedBy(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.updateListingCleanerManagedBy(
                request.params.listingId,
                request.body?.managedBy ?? null,
                request.user.id,
            );
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async createVendorProfile(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.createVendorProfile(request.body, request.user.id);
            return response.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }

    async updateVendorProfile(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.updateVendorProfile(Number(request.params.id), request.body, request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async deleteVendorProfile(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.deleteVendorProfile(Number(request.params.id), request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async createAssignment(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.createAssignment(Number(request.params.vendorProfileId), request.body, request.user.id);
            return response.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }

    async updateAssignment(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.updateAssignment(Number(request.params.id), request.body, request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async bulkUpdateAssignments(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.bulkUpdateAssignments(request.body.ids || [], request.body.updateData || {}, request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async deleteAssignment(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new VendorProfileService();
            const result = await service.deleteAssignment(Number(request.params.id), request.user.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}
