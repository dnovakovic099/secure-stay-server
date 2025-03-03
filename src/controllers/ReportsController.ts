import { Request, Response, NextFunction } from "express";
import { ReportsService } from "../services/ReportsService";

interface CustomRequest extends Request {
    user?: any;
}
export class ReportsController {
    async getReports(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reportsService = new ReportsService();
            return response.send(await reportsService.getReports(request));
        } catch (error) {
            return next(error);
        }
    }

} 