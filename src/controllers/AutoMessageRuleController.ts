import { NextFunction, Request, Response } from "express";
import { AutoMessageService } from "../services/AutoMessageService";

interface CustomRequest extends Request {
    user?: any;
}

const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * CRUD + manual run for rule-based automated guest messages (winbacks,
 * arrival/checkout reminders, day-of-week notes, one-off follow-ups).
 * Distinct from the legacy AutoMessageController / automated_messages feature.
 */
export class AutoMessageRuleController {
    async listRules(_request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new AutoMessageService().list({ includeDisabled: true });
            return response.status(200).json({ status: true, data, engineEnabled: AutoMessageService.isEnabled() });
        } catch (error) {
            return next(error);
        }
    }

    async createRule(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const saved = await new AutoMessageService().create({
                ...b,
                createdByUserId: toNum(request.user?.secureStayUserId ?? request.user?.id),
                createdByName:
                    request.user?.user_metadata?.full_name || request.user?.user_metadata?.name || request.user?.email || null,
            });
            return response.status(201).json({ status: true, data: saved });
        } catch (error: any) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async updateRule(request: Request, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) return response.status(400).json({ status: false, message: "Invalid id" });
            const saved = await new AutoMessageService().update(id, request.body || {});
            return response.status(200).json({ status: true, data: saved });
        } catch (error: any) {
            return response.status(400).json({ status: false, message: error.message });
        }
    }

    async deleteRule(request: Request, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) return response.status(400).json({ status: false, message: "Invalid id" });
            const ok = await new AutoMessageService().remove(id);
            return response.status(200).json({ status: ok });
        } catch (error) {
            return next(error);
        }
    }

    async listLogs(request: Request, response: Response, next: NextFunction) {
        try {
            const data = await new AutoMessageService().listLogs({
                ruleId: toNum(request.query.ruleId) ?? undefined,
                threadId: toNum(request.query.threadId) ?? undefined,
                limit: toNum(request.query.limit) ?? undefined,
            });
            return response.status(200).json({ status: true, data });
        } catch (error) {
            return next(error);
        }
    }

    /** Manual sweep — same evaluation the cron runs, for testing rules now. */
    async runNow(_request: Request, response: Response, next: NextFunction) {
        try {
            const result = await new AutoMessageService().processDueMessages();
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }
}
