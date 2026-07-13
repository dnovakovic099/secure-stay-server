import { NextFunction, Request, Response } from "express";
import { AllServiceRequestService } from "../services/AllServiceRequestService";
import { ServiceRequestThreadService } from "../services/ServiceRequestThreadService";

const SERVICE_REQUEST_THREAD_TYPES = new Set(["photographer", "cleaner", "maintenance", "itemSupply"]);

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

    async getThread(req: Request, res: Response, next: NextFunction) {
        try {
            const requestType = String(req.params.type || "");
            const requestId = Number(req.params.id);

            if (!SERVICE_REQUEST_THREAD_TYPES.has(requestType) || !Number.isFinite(requestId)) {
                return res.status(400).json({ message: "Invalid service request thread target" });
            }

            const service = new ServiceRequestThreadService();
            const result = await service.getThread(requestType as any, requestId);

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async postThreadMessage(req: Request, res: Response, next: NextFunction) {
        try {
            const requestType = String(req.params.type || "");
            const requestId = Number(req.params.id);
            const content = String(req.body?.content || "").trim();

            if (!SERVICE_REQUEST_THREAD_TYPES.has(requestType) || !Number.isFinite(requestId)) {
                return res.status(400).json({ message: "Invalid service request thread target" });
            }

            if (!content) {
                return res.status(400).json({ message: "Content is required" });
            }

            const user = (req as any).user;
            const userName = user?.user_metadata?.full_name || user?.email || "SecureStay User";
            const service = new ServiceRequestThreadService();
            const message = await service.postThreadMessage(requestType as any, requestId, content, userName);

            return res.status(201).json(message);
        } catch (error) {
            next(error);
        }
    }
}
