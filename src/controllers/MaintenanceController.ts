import { Request, Response, NextFunction } from "express";
import { MaintenanceService } from "../services/MaintenanceService";

interface CustomRequest extends Request {
    user?: any;
}

interface MaintenanceFilter {
    listingId?: string[];
    workCategory?: string[];
    contactId?: number[];
    status?: string[];
    fromDate?: string;
    toDate?: string;
    propertyType?: string[];
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
            const normalizeArray = (val: any) => {
                if (!val) return undefined;
                if (Array.isArray(val)) return val;
                return Object.values(val);
            };

            const filter: any = {
                listingId: normalizeArray(request.query.listingId),
                workCategory: normalizeArray(request.query.workCategory),
                contactId: normalizeArray(request.query.contactId) ? normalizeArray(request.query.contactId).map(Number) : undefined,
                workType: normalizeArray(request.query.workType),
                status: normalizeArray(request.query.status),
                fromDate: request.query.fromDate || undefined,
                toDate: request.query.toDate || undefined,
                propertyType: normalizeArray(request.query.propertyType),
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

    async exportMaintenace(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const userId = request.user.id;
            const maintenanceService = new MaintenanceService();

            const normalizeArray = (val: any) => {
                if (!val) return undefined;
                if (Array.isArray(val)) return val;
                return Object.values(val);
            };

            const filter: any = {
                listingId: normalizeArray(request.query.listingId),
                workCategory: normalizeArray(request.query.workCategory),
                contactId: normalizeArray(request.query.contactId) ? normalizeArray(request.query.contactId).map(Number) : undefined,
                workType: normalizeArray(request.query.workType),
                status: normalizeArray(request.query.status),
                fromDate: request.query.fromDate || undefined,
                toDate: request.query.toDate || undefined,
                propertyType: normalizeArray(request.query.propertyType),
                keyword: request.query.keyword || undefined,
                type: request.query.type || undefined,
                currentDate: request.query.currentDate
            };
            const excelBuffer = await maintenanceService.exportMaintenanceToExcel(filter, userId);

            response.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            response.setHeader(
                "Content-Disposition",
                "attachment; filename=" + "Maintenance_Export.xlsx"
            );

            return response.send(excelBuffer);
        } catch (error) {
            return next(error);
        }
    }

}
