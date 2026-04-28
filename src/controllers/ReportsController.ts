import { Request, Response, NextFunction } from "express";
import { ReportsService } from "../services/ReportsService";
import { ReviewReportsService } from "../services/ReviewReportsService";

interface CustomRequest extends Request {
    user?: any;
}
export class ReportsController {
    private reviewReportsService = new ReviewReportsService();

    async getReports(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const reportsService = new ReportsService();
            return response.send(await reportsService.getReports(request));
        } catch (error) {
            return next(error);
        }
    }

    async getReviewReportTemplates(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            return response.status(200).json({
                success: true,
                data: this.reviewReportsService.listTemplates(),
            });
        } catch (error) {
            return next(error);
        }
    }

    async listReviewReports(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            return response.status(200).json({
                success: true,
                data: await this.reviewReportsService.listReports(),
            });
        } catch (error) {
            return next(error);
        }
    }

    async createReviewReport(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const data = await this.reviewReportsService.createReport({
                name: request.body?.name,
                templateType: request.body?.templateType,
                filters: request.body?.filters || {},
            }, request.user?.id || null);

            return response.status(201).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async getReviewReport(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const data = await this.reviewReportsService.getReport(request.params.reportId);
            return response.status(200).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async reviseReviewReport(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const data = await this.reviewReportsService.reviseReport(request.params.reportId, {
                instruction: request.body?.instruction,
                targetSectionKey: request.body?.targetSectionKey || null,
            }, request.user?.id || null);
            return response.status(200).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async regenerateReviewReport(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const data = await this.reviewReportsService.regenerateReport(request.params.reportId, {
                instruction: request.body?.instruction || null,
                targetSectionKey: request.body?.targetSectionKey || null,
            }, request.user?.id || null);
            return response.status(200).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async updateReviewReportSection(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const data = await this.reviewReportsService.saveSectionEdit(
                request.params.reportId,
                request.params.sectionKey as any,
                String(request.body?.content || ""),
                request.user?.id || null
            );
            return response.status(200).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }
}
