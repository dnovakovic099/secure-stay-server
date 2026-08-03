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
            const result = await new AutoMessageService().listLogs({
                ruleId: toNum(request.query.ruleId) ?? undefined,
                threadId: toNum(request.query.threadId) ?? undefined,
                status: request.query.status ? String(request.query.status) : undefined,
                limit: toNum(request.query.limit) ?? undefined,
                offset: toNum(request.query.offset) ?? undefined,
            });
            // Existing consumers read `data.data[]`; new activity page reads
            // pagination metadata off `data.total / data.limit / data.offset`.
            return response.status(200).json({ status: true, ...result });
        } catch (error) {
            return next(error);
        }
    }

    /** Manual sweep — same evaluation the cron runs, for testing rules now. */
    async runNow(request: Request, response: Response, next: NextFunction) {
        try {
            const dryRun = String(request.query.dryRun || request.body?.dryRun || "").toLowerCase() === "true";
            const result = await new AutoMessageService().processDueMessages({ dryRun });
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async getLog(request: Request, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) return response.status(400).json({ status: false, message: "Invalid id" });
            const log = await new AutoMessageService().getLog(id);
            if (!log) return response.status(404).json({ status: false, message: "Log not found" });
            return response.status(200).json({ status: true, data: log });
        } catch (error) {
            return next(error);
        }
    }

    async sendSkippedNow(request: Request, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) return response.status(400).json({ status: false, message: "Invalid id" });
            const overrideBody = typeof request.body?.body === "string" ? request.body.body : undefined;
            const log = await new AutoMessageService().sendSkippedNow(id, overrideBody);
            return response.status(200).json({ status: true, data: log });
        } catch (error: any) {
            return response.status(400).json({ status: false, message: error?.message });
        }
    }

    async dismissSkipped(request: Request, response: Response, next: NextFunction) {
        try {
            const id = toNum(request.params.id);
            if (!id) return response.status(400).json({ status: false, message: "Invalid id" });
            const log = await new AutoMessageService().dismissSkipped(id);
            return response.status(200).json({ status: true, data: log });
        } catch (error: any) {
            return response.status(400).json({ status: false, message: error?.message });
        }
    }

    /**
     * Preview a single rule against a single thread — used by the editor's
     * "Test on this thread" panel. The rule can be an unsaved form (frontend
     * ships whatever is in the editor state) or an existing rule by id.
     */
    async previewRule(request: Request, response: Response, next: NextFunction) {
        try {
            const b = request.body || {};
            const threadId = toNum(b.threadId);
            if (!threadId) return response.status(400).json({ status: false, message: "threadId is required" });

            const service = new AutoMessageService();
            let rule: any = b.rule;
            if (!rule && b.ruleId) {
                const list = await service.list({ includeDisabled: true });
                rule = list.find((r: any) => r.id === toNum(b.ruleId));
                if (!rule) return response.status(404).json({ status: false, message: "Rule not found" });
            }
            if (!rule || !rule.messageTemplate || !rule.triggerType) {
                return response.status(400).json({ status: false, message: "rule (with messageTemplate + triggerType) is required" });
            }
            const preview = await service.previewRule(rule, threadId);
            return response.status(200).json({ status: true, data: preview });
        } catch (error: any) {
            return response.status(400).json({ status: false, message: error?.message });
        }
    }
}
