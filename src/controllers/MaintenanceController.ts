import { Request, Response, NextFunction } from "express";
import { MaintenanceService } from "../services/MaintenanceService";

interface CustomRequest extends Request {
    user?: any;
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

}
