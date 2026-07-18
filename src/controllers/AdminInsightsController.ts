import { NextFunction, Request, Response } from "express";
import { AdminInsightsService, InsightsFilters, isAdminEmail } from "../services/AdminInsightsService";
import { AdminWorkloadService } from "../services/AdminWorkloadService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

/** Parse ?userIds=1,2,3 -> [1,2,3], or repeated userIds params. */
const toIdList = (v: any): number[] | null => {
    if (v == null) return null;
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const out = arr
        .map((x) => Number(String(x).trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    return out.length ? out : null;
};

const toStringList = (v: any): string[] | null => {
    if (v == null) return null;
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const out = arr.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : null;
};

const filtersOf = (req: Request): InsightsFilters => {
    const days = Number(req.query.days);
    return {
        days: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30,
        startDate: (req.query.startDate as string) || null,
        endDate: (req.query.endDate as string) || null,
        listingId:
            req.query.listingId != null && String(req.query.listingId).length
                ? Number(req.query.listingId)
                : null,
        userIds: toIdList(req.query.userIds),
        userType: (req.query.userType as string) || null,
        kinds: toStringList(req.query.kinds),
    };
};

/** Admin insights: AI-training attribution, response stats, employee workload. */
export class AdminInsightsController {
    /** Lightweight probe so the dashboard can show/hide the admin page. */
    me = async (req: CustomRequest, res: Response) => {
        return res.status(200).json({ status: true, admin: isAdminEmail(req.user?.email) });
    };

    overview = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().overview(filtersOf(req));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    feedbackLog = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().feedbackLog(
                filtersOf(req),
                Number(req.query.limit) || 50,
                Number(req.query.offset) || 0
            );
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    /** Drill-down: entries behind a "Who trains the AI" cell. */
    trainingDetail = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.params.userId);
            const metric = String(req.query.metric || "");
            if (!Number.isFinite(userId) || !metric) {
                return res.status(400).json({ status: false, message: "userId and metric required" });
            }
            const data = await new AdminInsightsService().trainingDetail(
                userId,
                metric,
                filtersOf(req),
                Number(req.query.limit) || 100,
                Number(req.query.offset) || 0
            );
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    correctFeedback = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const corrector = Number(req.user?.id);
            if (!Number.isFinite(id) || !Number.isFinite(corrector)) {
                return res.status(400).json({ status: false, message: "invalid" });
            }
            const ok = await new AdminInsightsService().correctFeedback(id, corrector, {
                feedbackText: req.body?.feedbackText,
                correctedResponse: req.body?.correctedResponse,
            });
            return res.status(200).json({ status: ok });
        } catch (error) {
            return next(error);
        }
    };

    correctLearnedFact = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const corrector = Number(req.user?.id);
            if (!Number.isFinite(id) || !Number.isFinite(corrector)) {
                return res.status(400).json({ status: false, message: "invalid" });
            }
            const ok = await new AdminInsightsService().correctLearnedFact(id, corrector, {
                question: req.body?.question,
                answer: req.body?.answer,
                scope: req.body?.scope,
            });
            return res.status(200).json({ status: ok });
        } catch (error) {
            return next(error);
        }
    };

    correctLearningPrompt = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const corrector = Number(req.user?.id);
            if (!Number.isFinite(id) || !Number.isFinite(corrector)) {
                return res.status(400).json({ status: false, message: "invalid" });
            }
            const ok = await new AdminInsightsService().correctLearningPrompt(id, corrector, {
                answerText: req.body?.answerText,
                answerScope: req.body?.answerScope,
            });
            return res.status(200).json({ status: ok });
        } catch (error) {
            return next(error);
        }
    };

    listUsers = async (_req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().listUsers();
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    listListings = async (_req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const data = await new AdminInsightsService().listListings();
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    };

    workload = async (req: CustomRequest, res: Response, next: NextFunction) => {
        try {
            const days = Number(req.query.days) || 30;
            const data = await new AdminWorkloadService().report(Math.min(Math.max(days, 1), 90));
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
