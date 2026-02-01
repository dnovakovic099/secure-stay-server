import { Request, Response } from "express";
import { CleanerRequestService } from "../services/CleanerRequestService";

export class CleanerRequestController {
    private cleanerRequestService: CleanerRequestService;

    constructor() {
        this.cleanerRequestService = new CleanerRequestService();
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
            const result = await this.cleanerRequestService.create(propertyId, req.body, createdBy);

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
            const result = await this.cleanerRequestService.update(id, req.body, updatedBy);

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
