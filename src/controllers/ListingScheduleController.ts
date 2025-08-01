import { ListingScheduleService } from "../services/ListingScheduleService";
import { Request, Response, NextFunction } from "express";

interface CustomRequest extends Request {
    user?: {
        id: string;
    };
}

export class ListingScheduleController {
    public async createListingSchedule(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingScheduleService= new ListingScheduleService();
            const newSchedule = await listingScheduleService.createListingSchedule(req.body, userId);
            return res.status(201).json(newSchedule);
        } catch (error) {
            next(error);
        }
    }

    public async getListingSchedulesByListingId(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingId = parseInt(req.params.listingId);
            const listingScheduleService = new ListingScheduleService();
            const schedules = await listingScheduleService.getListingSchedulesByListingId(listingId);
            return res.status(200).json(schedules);
        } catch (error) {
            next(error);
        }
    }

    public async getListingScheduleById(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const listingScheduleService = new ListingScheduleService();
            const schedule = await listingScheduleService.getListingScheduleById(id);
            if (!schedule) {
                return res.status(404).json({ message: "Listing schedule not found" });
            }
            return res.status(200).json(schedule);
        } catch (error) {
            next(error);
        }
    }

    public async updateListingSchedule(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.id;
            const listingScheduleService = new ListingScheduleService();
            const updatedSchedule = await listingScheduleService.updateListingSchedule(req.body, userId);
            return res.status(200).json(updatedSchedule);
        } catch (error) {
            next(error);
        }
    }

    public async deleteListingSchedule(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const listingScheduleService = new ListingScheduleService();
            const schedule = await listingScheduleService.getListingScheduleById(id);
            if (!schedule) {
                return res.status(404).json({ message: "Listing schedule not found" });
            }
            await listingScheduleService.deleteListingSchedule(id, req.user?.id);
            return res.status(200).json({ message: "Listing schedule deleted successfully" });
        } catch (error) {
            next(error);
        }
    }
}