import { Request, Response } from "express";
import { CleanerRequestService } from "../services/CleanerRequestService";

export class CleanerRequestController {
    private cleanerRequestService: CleanerRequestService;

    constructor() {
        this.cleanerRequestService = new CleanerRequestService();
    }

    async getAll(req: Request, res: Response): Promise<Response> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const status = req.query.status as string[] | undefined;
            const propertyId = req.query.propertyId
                ? (Array.isArray(req.query.propertyId)
                    ? (req.query.propertyId as string[]).map(Number)
                    : [Number(req.query.propertyId)])
                : undefined;

            const result = await this.cleanerRequestService.getAll({ page, limit, status, propertyId });

            return res.status(200).json({
                success: true,
                data: result.data,
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / result.limit),
                },
            });
        } catch (error: any) {
            console.error("Error fetching cleaner requests:", error);
            return res.status(500).json({ success: false, message: error.message || "Failed to fetch cleaner requests" });
        }
    }

    async getByProperty(req: Request, res: Response): Promise<Response> {
        try {
            const propertyId = parseInt(req.params.propertyId);

            if (isNaN(propertyId)) {
                return res.status(400).json({ message: "Invalid property ID" });
            }

            const result = await this.cleanerRequestService.getByProperty(propertyId);
            return res.status(200).json(result);
        } catch (error: any) {
            console.error("Error fetching cleaner request:", error);
            return res.status(500).json({ message: error.message || "Failed to fetch cleaner request" });
        }
    }

    async create(req: Request, res: Response): Promise<Response> {
        try {
            const propertyId = parseInt(req.params.propertyId);

            if (isNaN(propertyId)) {
                return res.status(400).json({ message: "Invalid property ID" });
            }

            const createdBy = (req as any).user?.email || null;
            const authenticatedUserId = (req as any).user?.id;
            const result = await this.cleanerRequestService.create(propertyId, req.body, createdBy, authenticatedUserId);

            return res.status(201).json({
                message: "Cleaner request created successfully",
                data: result,
            });
        } catch (error: any) {
            console.error("Error creating cleaner request:", error);
            return res.status(500).json({ message: error.message || "Failed to create cleaner request" });
        }
    }

    async update(req: Request, res: Response): Promise<Response> {
        try {
            const id = parseInt(req.params.id);

            if (isNaN(id)) {
                return res.status(400).json({ message: "Invalid request ID" });
            }

            const updatedBy = (req as any).user?.email || null;
            const authenticatedUserId = (req as any).user?.id;
            const result = await this.cleanerRequestService.update(id, req.body, updatedBy, authenticatedUserId);

            return res.status(200).json({
                message: "Cleaner request updated successfully",
                data: result,
            });
        } catch (error: any) {
            console.error("Error updating cleaner request:", error);
            return res.status(500).json({ message: error.message || "Failed to update cleaner request" });
        }
    }
}
