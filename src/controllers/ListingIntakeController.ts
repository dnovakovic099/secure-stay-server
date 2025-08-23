import { Request, Response, NextFunction } from "express";
import { ListingIntakeService } from "../services/ListingIntakeService";

interface CustomRequest extends Request {
    user?: {
        id: string;
    };
}

export class ListingIntakeController {
    public async createListingIntake(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingIntakeService = new ListingIntakeService();
            const listingIntake = await listingIntakeService.createListingIntake(req.body, userId);
            return res.status(201).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

    public async updateListingIntake(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingIntakeService = new ListingIntakeService();
            const listingIntake = await listingIntakeService.updateListingIntake(req.body, userId);
            return res.status(200).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

    public async getListingIntake(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingIntakeService = new ListingIntakeService();
            const filter: any = {
                status: req.query.status || undefined,
                clientName: req.query.clientName || undefined,
                clientContact: req.query.clientContact || undefined,
                page: req.query.page,
                limit: req.query.limit
            };
            const listingIntake = await listingIntakeService.getListingIntake(filter, userId);
            return res.status(200).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

    public async deleteListingIntake(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingIntakeService = new ListingIntakeService();
            const listingIntake = await listingIntakeService.deleteListingIntake(Number(req.params.id), userId);
            return res.status(200).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

    public async getListingIntakeById(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingIntakeService = new ListingIntakeService();
            const listingIntake = await listingIntakeService.getListingIntakeById(Number(req.params.id));
            return res.status(200).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

    public async saveBedTypes(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingIntakeService = new ListingIntakeService();
            const bedTypes = await listingIntakeService.saveBedTypes(req.body);
            return res.status(201).json(bedTypes);
        } catch (error) {
            next(error);
        }
    }

    public async updateBedTypes(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingIntakeService = new ListingIntakeService();
            const bedTypes = await listingIntakeService.updateBedTypes(req.body);
            return res.status(200).json(bedTypes);
        } catch (error) {
            next(error);
        }
    }

    public async getBedTypes(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingIntakeService = new ListingIntakeService();
            const bedTypes = await listingIntakeService.getBedTypes(Number(req.params.listingIntakeId));
            return res.status(200).json(bedTypes);
        } catch (error) {
            next(error);
        }
    }

    public async deleteBedTypes(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingIntakeService = new ListingIntakeService();
            const bedTypes = await listingIntakeService.deleteBedTypes(req.body);
            return res.status(200).json(bedTypes);
        } catch (error) {
            next(error);
        }
    }

    public async publishListingIntake(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingIntakeService = new ListingIntakeService();
            const listingIntake = await listingIntakeService.publishListingIntakeToHostaway(Number(req.params.id), userId);
            return res.status(200).json(listingIntake);
        } catch (error) {
            next(error);
        }
    }

}