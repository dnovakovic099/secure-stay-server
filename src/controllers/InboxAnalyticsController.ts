import { NextFunction, Request, Response } from "express";
import { AnalyticsFilters, InboxAnalyticsService } from "../services/InboxAnalyticsService";

/**
 * Backs the Inbox → Analytics page: AI-vs-team / AI-vs-user divergence report,
 * improvement trend, and reason breakdown. Read-only (plus a bounded, on-demand
 * semantic backfill trigger).
 */
/** "quo" selects the Quo SMS report; anything else = the Hostify inbox. */
function sourceOf(request: Request): "hostify" | "quo" {
    return request.query.source === "quo" ? "quo" : "hostify";
}

/**
 * Parse the shared filter set out of a query string. Accepts either a single
 * `listingId` param or a comma-separated `listingIds`; dates as ISO YYYY-MM-DD.
 */
function filtersOf(request: Request): AnalyticsFilters {
    const parseIds = (raw: unknown): number[] => {
        if (raw == null) return [];
        const list = Array.isArray(raw) ? raw : String(raw).split(",");
        return list
            .map((v) => Number(String(v).trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
    };
    const ids = [
        ...parseIds(request.query.listingIds),
        ...parseIds(request.query.listingId),
    ];
    return {
        startDate: typeof request.query.startDate === "string" ? request.query.startDate : null,
        endDate: typeof request.query.endDate === "string" ? request.query.endDate : null,
        listingIds: ids.length ? [...new Set(ids)] : null,
        taughtByName:
            typeof request.query.taughtBy === "string" && request.query.taughtBy.trim()
                ? String(request.query.taughtBy).trim()
                : null,
    };
}

export class InboxAnalyticsController {
    async report(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const granularity = (request.query.granularity as "day" | "week" | "month") || "day";
            const data = await new InboxAnalyticsService().report(
                sinceDays,
                granularity,
                sourceOf(request),
                filtersOf(request)
            );
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
            const data = await new InboxAnalyticsService().worstReplies(
                metric,
                sinceDays,
                limit,
                sourceOf(request),
                filtersOf(request)
            );
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async misses(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const includeResolved = request.query.includeResolved === "true";
            const data = await new InboxAnalyticsService().misses(
                sinceDays,
                includeResolved,
                sourceOf(request),
                filtersOf(request)
            );
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async teachMiss(request: Request, response: Response, next: NextFunction) {
        try {
            const id = Number(request.params.id);
            const answer = String(request.body?.answer || "");
            const rawScope = request.body?.scope;
            const scope: "property" | "portfolio" | "selected" =
                rawScope === "portfolio"
                    ? "portfolio"
                    : rawScope === "selected"
                    ? "selected"
                    : "property";
            const listingIds: number[] = Array.isArray(request.body?.listingIds)
                ? request.body.listingIds
                      .map((v: any) => Number(v))
                      .filter((n: number) => Number.isFinite(n) && n > 0)
                : [];
            const phases: string[] = Array.isArray(request.body?.phases)
                ? request.body.phases
                      .map((v: any) => String(v).trim().toLowerCase())
                      .filter(Boolean)
                : [];
            const userId = (request as any).user?.id ?? null;
            const data = await new InboxAnalyticsService().teachMiss(id, answer, scope, userId, {
                listingIds,
                phases,
            });
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
            const data = await new InboxAnalyticsService().learningPrompts(source, filtersOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Listings that appear in the analytics window — powers the property filter dropdown. */
    async listings(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const data = await new InboxAnalyticsService().listListings(sourceOf(request), sinceDays);
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Staff who have taught the AI in the analytics window — powers the "user" filter. */
    async taughtByUsers(request: Request, response: Response, next: NextFunction) {
        try {
            const sinceDays = request.query.sinceDays ? Number(request.query.sinceDays) : 60;
            const data = await new InboxAnalyticsService().listTaughtByUsers(sourceOf(request), sinceDays);
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
