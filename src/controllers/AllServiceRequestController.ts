import { NextFunction, Request, Response } from "express";
import { AllServiceRequestService } from "../services/AllServiceRequestService";

export class AllServiceRequestController {
    async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const service = new AllServiceRequestService();

            const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

            const normalizeArray = (val: any) => {
                if (!val) return undefined;
                if (Array.isArray(val)) return val;
                if (typeof val === 'object') return Object.values(val);
                return [val];
            };

            const status = normalizeArray(req.query.status) as string[];
            const propertyId = normalizeArray(req.query.propertyId) ? normalizeArray(req.query.propertyId).map(Number) : undefined;

            const result = await service.getAll({ page, limit, status, propertyId });

            return res.status(200).json({
                data: result.data,
                pagination: {
                    total: result.total,
                    page: result.page,
                    limit: result.limit,
                    totalPages: result.totalPages,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    async exportCSV(req: Request, res: Response, next: NextFunction) {
        try {
            const service = new AllServiceRequestService();

            const normalizeArray = (val: any) => {
                if (!val) return undefined;
                if (Array.isArray(val)) return val;
                if (typeof val === 'object') return Object.values(val);
                return [val];
            };

            const status = normalizeArray(req.query.status) as string[];
            const propertyId = normalizeArray(req.query.propertyId) ? normalizeArray(req.query.propertyId).map(Number) : undefined;
            const type = req.query.type as string;

            const excelBuffer = await service.exportToExcel({ status, propertyId, type });

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader(
                "Content-Disposition",
                "attachment; filename=" + "Service_Requests_Export.xlsx"
            );

            return res.send(excelBuffer);
        } catch (error) {
            next(error);
        }
    }
}
