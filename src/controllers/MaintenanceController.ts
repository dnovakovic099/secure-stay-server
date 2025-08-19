import { Request, Response, NextFunction } from "express";
import { MaintenanceService } from "../services/MaintenanceService";

interface CustomRequest extends Request {
    user?: any;
}

interface MaintenanceFilter {
    listingId?: string[];
    workCategory?: string[];
    contactId?: number[];
    fromDate?: string;
    toDate?: string;
    propertyType?: number[];
    keyword?: string;
    type?: string;
    page: number;
    limit: number;
}

export class MaintenanceController {
    async createMaintenace(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const maintenanceService = new MaintenanceService();
            const maintenance = await maintenanceService.createMaintenance(request.body, userId);
            return response.status(201).json(maintenance);
        } catch (error) {
            return next(error);
        }
    }

    async updateMaintenace(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const maintenanceService = new MaintenanceService();
            const maintenance = await maintenanceService.updateMaintenance(request.body, userId);
            return response.status(200).json(maintenance);
        } catch (error) {
            return next(error);
        }
    }

    async deleteMaintenace(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const id = Number(request.params.id);
            const maintenanceService = new MaintenanceService();
            const maintenance = await maintenanceService.deleteMaintenance(id, userId);
            return response.status(200).json(maintenance);
        } catch (error) {
            return next(error);
        }
    }

    async getMaintenace(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const maintenanceService = new MaintenanceService();
            const filter: any = {
                listingId: request.query.listingId || undefined,
                workCategory: request.query.workCategory || undefined,
                contactId: request.query.contactId || undefined,
                fromDate: request.query.fromDate || undefined,
                toDate: request.query.toDate || undefined,
                propertyType: request.query.propertyType || undefined,
                keyword: request.query.keyword || undefined,
                type: request.query.type || undefined,
                page: request.query.page,
                limit: request.query.limit,
                currentDate: request.query.currentDate
            };
            const maintenance = await maintenanceService.getMaintenanceList(filter, userId);
            return response.status(200).json(maintenance);
        } catch (error) {
            return next(error);
        }
    }

}
