import { NextFunction, Request, Response } from "express";
import { InboxAnalyticsService } from "../services/InboxAnalyticsService";

/**
 * Backs the Inbox → Analytics page: AI-vs-team / AI-vs-user divergence report,
 * improvement trend, and reason breakdown. Read-only (plus a bounded, on-demand
 * semantic backfill trigger).
 */
export class InboxAnalyticsController {
    async report(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const granularity = (request.query.granularity as "day" | "week" | "month") || "day";
            const data = await new InboxAnalyticsService().report(sinceDays, granularity);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async worst(request: Request, response: Response, next: NextFunction) {
        try {
            const metric = (request.query.metric as "coverage" | "semantic" | "jaccard") || "coverage";
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const limit = request.query.limit ? Number(request.query.limit) : 50;
            const data = await new InboxAnalyticsService().worstReplies(metric, sinceDays, limit);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async misses(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const includeResolved = request.query.includeResolved === "true";
            const data = await new InboxAnalyticsService().misses(sinceDays, includeResolved);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async resolveMiss(request: Request, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            const resolved = request.body?.resolved !== false;
            const data = await new InboxAnalyticsService().resolveMiss(id, resolved);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async backfill(request: Request, response: Response, next: NextFunction) {
        try {
            const limit = request.query.limit ? Number(request.query.limit) : 500;
            const data = await new InboxAnalyticsService().backfillSemantic(limit);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }
}
