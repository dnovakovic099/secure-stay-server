import { NextFunction, Request, Response } from "express";
import { UtilityProviderService } from "../services/UtilityProviderService";
import { UtilityManagedOptionKind } from "../entity/UtilityManagedOption";

interface CustomRequest extends Request {
    user?: {
        id: string;
    };
}

export class UtilityProviderController {
    private getManagedOptionKind(request: Request): UtilityManagedOptionKind {
        return request.params.kind as UtilityManagedOptionKind;
    }

    async createUtilityProvider(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const created = await service.createUtilityProvider(request.body, request.user!.id);
            return response.status(201).json(created);
        } catch (error) {
            next(error);
        }
    }

    async updateUtilityProvider(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const updated = await service.updateUtilityProvider(Number(request.params.id), request.body, request.user!.id);
            return response.status(200).json(updated);
        } catch (error) {
            next(error);
        }
    }

    async deleteUtilityProvider(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.deleteUtilityProvider(Number(request.params.id), request.user!.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getUtilityProviders(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.getUtilityProviders({
                search: typeof request.query.search === "string" ? request.query.search : undefined,
                providerType: Array.isArray(request.query.providerType)
                    ? request.query.providerType.map(String)
                    : typeof request.query.providerType === "string"
                        ? [request.query.providerType]
                        : undefined,
                listingId: request.query.listingId ? Number(request.query.listingId) : undefined,
            });
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getUtilityProvidersByListing(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.getUtilityProvidersByListing(Number(request.params.listingId));
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getUtilityPaymentMethods(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.getUtilityPaymentMethods();
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getUtilityManagedOptions(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.getUtilityManagedOptions(this.getManagedOptionKind(request));
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async createUtilityManagedOption(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const created = await service.createUtilityManagedOption(this.getManagedOptionKind(request), request.body, request.user!.id);
            return response.status(201).json(created);
        } catch (error) {
            next(error);
        }
    }

    async updateUtilityManagedOption(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const updated = await service.updateUtilityManagedOption(this.getManagedOptionKind(request), Number(request.params.id), request.body, request.user!.id);
            return response.status(200).json(updated);
        } catch (error) {
            next(error);
        }
    }

    async deleteUtilityManagedOption(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.deleteUtilityManagedOption(this.getManagedOptionKind(request), Number(request.params.id), request.user!.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async createUtilityPaymentMethod(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const created = await service.createUtilityPaymentMethod(request.body, request.user!.id);
            return response.status(201).json(created);
        } catch (error) {
            next(error);
        }
    }

    async updateUtilityPaymentMethod(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const updated = await service.updateUtilityPaymentMethod(Number(request.params.id), request.body, request.user!.id);
            return response.status(200).json(updated);
        } catch (error) {
            next(error);
        }
    }

    async deleteUtilityPaymentMethod(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const service = new UtilityProviderService();
            const result = await service.deleteUtilityPaymentMethod(Number(request.params.id), request.user!.id);
            return response.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}
