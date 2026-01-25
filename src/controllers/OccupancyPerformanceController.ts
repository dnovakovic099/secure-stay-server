import { Request, Response } from "express";
import { OccupancyPerformanceService } from "../services/OccupancyPerformanceService";
import logger from "../utils/logger.utils";

export class OccupancyPerformanceController {
    private reportService = new OccupancyPerformanceService();

    getReport = async (req: Request, res: Response) => {
        try {
            const { tags, listingIds, startDate, endDate, velocityThreshold } = req.query;

            const filters = {
                tags: tags ? (tags as string).split(",") : undefined,
                listingIds: listingIds ? (listingIds as string).split(",").map(id => parseInt(id)) : undefined,
                startDate: startDate as string,
                endDate: endDate as string,
                velocityThreshold: velocityThreshold as string
            };

            const data = await this.reportService.getReport(filters);
            res.json(data);
        } catch (error) {
            logger.error("Error in getOccupancyPerformanceReport:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    };

    getTags = async (req: Request, res: Response) => {
        try {
            const tags = await this.reportService.getUniqueTags();
            res.json(tags);
        } catch (error) {
            logger.error("Error in getTags:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    };
}
