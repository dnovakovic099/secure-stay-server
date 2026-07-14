import { NextFunction, Request, Response } from "express";
import { AdminInsightsService, isAdminEmail } from "../services/AdminInsightsService";
import { AdminWorkloadService } from "../services/AdminWorkloadService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

const daysOf = (req: Request): number => {
    const d = Number(req.query.days);
    return Number.isFinite(d) && d > 0 ? Math.min(d, 90) : 30;
};

/** Admin insights: AI-training attribution, inbox reply stats, employee workload. */
export class AdminInsightsController {
    /** Lightweight probe so the dashboard can show/hide the admin page. */
    me = async (req: CustomRequest, res: Response) => {
        return res.status(200).json({ status: true, admin: isAdminEmail(req.user?.email) });
    };

    overview = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().overview(daysOf(req));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    feedbackLog = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().feedbackLog(
                daysOf(req),
                Number(req.query.limit) || 50,
                Number(req.query.offset) || 0
            );
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    workload = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminWorkloadService().report(daysOf(req));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    workloadStatus = async (_req: CustomRequest, res: Response) => {
        return res.status(200).json({ status: true, data: AdminWorkloadService.getStatus() });
    };

    /** Kick a background call-sync + grading run (fire and forget). */
    workloadRefresh = async (req: CustomRequest, res: Response) => {
        const running = AdminWorkloadService.getStatus().running;
        if (!running) {
            const sinceDays = Number(req.body?.sinceDays) || 3;
            const gradeDays = Number(req.body?.gradeDays) || 30;
            new AdminWorkloadService()
                .refresh({ sinceDays, gradeDays })
                .catch((err) => logger.error(`[AdminInsights] workload refresh failed: ${err?.message}`));
        }
        return res.status(202).json({ status: true, started: !running, data: AdminWorkloadService.getStatus() });
    };
}
