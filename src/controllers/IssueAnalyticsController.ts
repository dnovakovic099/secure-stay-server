import { NextFunction, Request, Response } from "express";
import {
    IssueAnalyticsFilters,
    IssueAnalyticsGranularity,
    IssueAnalyticsService,
} from "../services/IssueAnalyticsService";
import { IssueAIService } from "../services/IssueAIService";

/**
 * Backs the Guest Issues → Resolution Analytics page: how IR Copilot is
 * performing against the feedback the team gives it, who is giving that
 * feedback, and what the bot actually did on tickets. Read-only apart from the
 * inline feedback submit, which reuses the IR Copilot feedback path.
 */

/**
 * Parse the shared filter set out of a query string. Accepts either a single
 * `listingId` param or a comma-separated `listingIds`; dates as ISO YYYY-MM-DD.
 */
function filtersOf(request: Request): IssueAnalyticsFilters {
    const parseIds = (raw: unknown): number[] => {
        if (raw == null) return [];
        const list = Array.isArray(raw) ? raw : String(raw).split(",");
        return list.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n) && n > 0);
    };
    const ids = [...parseIds(request.query.listingIds), ...parseIds(request.query.listingId)];
    const str = (key: string): string | null => {
        const v = request.query[key];
        return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const reviewer = Number(request.query.reviewerId);
    return {
        startDate: str("startDate"),
        endDate: str("endDate"),
        listingIds: ids.length ? [...new Set(ids)] : null,
        reviewerId: Number.isFinite(reviewer) && reviewer > 0 ? reviewer : null,
        lane: str("lane"),
        category: str("category"),
    };
}

function sinceDaysOf(request: Request): number {
    return request.query.sinceDays ? Number(request.query.sinceDays) : 60;
}

export class IssueAnalyticsController {
    async report(request: Request, response: Response, next: NextFunction) {
        try {
            const granularity = (request.query.granularity as IssueAnalyticsGranularity) || "day";
            const data = await new IssueAnalyticsService().report(
                sinceDaysOf(request),
                granularity,
                filtersOf(request)
            );
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async queue(request: Request, response: Response, next: NextFunction) {
        try {
            const state = typeof request.query.state === "string" ? request.query.state : "unrated";
            const limit = request.query.limit ? Number(request.query.limit) : 40;
            const data = await new IssueAnalyticsService().queue(
                sinceDaysOf(request),
                state,
                limit,
                filtersOf(request)
            );
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async feedbackLog(request: Request, response: Response, next: NextFunction) {
        try {
            const limit = request.query.limit ? Number(request.query.limit) : 50;
            const offset = request.query.offset ? Number(request.query.offset) : 0;
            const data = await new IssueAnalyticsService().feedbackLog(
                sinceDaysOf(request),
                limit,
                offset,
                filtersOf(request)
            );
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Rate a suggestion straight from the analytics queue. */
    async submitFeedback(request: any, response: Response, next: NextFunction) {
        try {
            const body = request.body || {};
            const userId = Number(request.user?.secureStayUserId ?? request.user?.id) || null;
            const data = await new IssueAIService().submitFeedback({
                suggestionId: body.suggestionId != null ? Number(body.suggestionId) : null,
                issueId: body.issueId != null ? Number(body.issueId) : null,
                userId,
                rating: body.rating === "up" || body.rating === "down" ? body.rating : null,
                categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
                feedbackText: body.feedbackText ?? null,
                correctedResponse: body.correctedResponse ?? null,
            });
            return response.status(201).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async listings(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new IssueAnalyticsService().listListings(sinceDaysOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async reviewers(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new IssueAnalyticsService().listReviewers(sinceDaysOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    async categories(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new IssueAnalyticsService().listCategories(sinceDaysOf(request));
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }
}
