import { NextFunction, Request, Response } from "express";
import { AllServiceRequestService } from "../services/AllServiceRequestService";

export class AllServiceRequestController {
    async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const service = new AllServiceRequestService();

            const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

            // Parse array query params
            const status = req.query.status
                ? (Array.isArray(req.query.status)
                    ? req.query.status as string[]
                    : Object.values(req.query.status as any) as string[])
                : undefined;

            const propertyId = req.query.propertyId
                ? (Array.isArray(req.query.propertyId)
                    ? (req.query.propertyId as string[]).map(Number)
                    : Object.values(req.query.propertyId as any).map(Number))
                : undefined;

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
}
