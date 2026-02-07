import { Request, Response } from "express";
import { NoBookingReportService } from "../services/NoBookingReportService";
import logger from "../utils/logger.utils";

export class NoBookingReportController {
    private reportService = new NoBookingReportService();

    getReport = async (req: Request, res: Response) => {
        try {
            const { tags, noBookingWindow } = req.query;

            const filters = {
                tags: tags ? (tags as string).split(",") : undefined,
                noBookingWindow: (noBookingWindow as "7" | "14" | "30") || "7"
            };

            const data = await this.reportService.getReport(filters);
            res.json(data);
        } catch (error) {
            logger.error("Error in getNoBookingReport:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    };

    getTags = async (req: Request, res: Response) => {
        try {
            const tags = await this.reportService.getUniqueTags();
            res.json(tags);
        } catch (error) {
            logger.error("Error in getNoBookingTags:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    };
}
