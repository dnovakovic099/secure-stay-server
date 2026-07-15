import { NextFunction, Request, Response } from "express";
import { InboxAnalyticsService } from "../services/InboxAnalyticsService";

/**
 * Backs the Inbox → Analytics page: AI-vs-team / AI-vs-user divergence report,
 * improvement trend, and reason breakdown. Read-only (plus a bounded, on-demand
 * semantic backfill trigger).
 */
/** "quo" selects the Quo SMS report; anything else = the Hostify inbox. */
function sourceOf(request: Request): "hostify" | "quo" {
    return request.query.source === "quo" ? "quo" : "hostify";
}

export class InboxAnalyticsController {
    async report(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const granularity = (request.query.granularity as "day" | "week" | "month") || "day";
            const data = await new InboxAnalyticsService().report(sinceDays, granularity, sourceOf(request));
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
            const data = await new InboxAnalyticsService().worstReplies(metric, sinceDays, limit, sourceOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async misses(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const includeResolved = request.query.includeResolved === "true";
            const data = await new InboxAnalyticsService().misses(sinceDays, includeResolved, sourceOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async teachMiss(request: Request, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            const answer = String(request.body?.answer || "");
            const scope = request.body?.scope === "portfolio" ? "portfolio" : "property";
            const userId = (request as any).user?.id ?? null;
            const data = await new InboxAnalyticsService().teachMiss(id, answer, scope, userId);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async resolveMiss(request: Request, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            const resolved = request.body?.resolved !== false;
            const userId = (request as any).user?.id ?? null;
            const data = await new InboxAnalyticsService().resolveMiss(id, resolved, userId);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Pending "questions from the AI" queue (learning prompts), both inboxes. */
    async learningPrompts(request: Request, response: Response, next: NextFunction) {
        try {
            const source =
                request.query.source === "quo" || request.query.source === "hostify"
                    ? (request.query.source as "quo" | "hostify")
                    : undefined; // no filter = both inboxes
            const data = await new InboxAnalyticsService().learningPrompts(source);
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
