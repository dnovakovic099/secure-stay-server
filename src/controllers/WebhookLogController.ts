import { Request, Response } from "express";
import { webhookLogService, WebhookLogListFilters } from "../services/WebhookLogService";
import logger from "../utils/logger.utils";

export class WebhookLogController {
    list = async (req: Request, res: Response) => {
        try {
            const q = req.query;
            const sourcesParam = (q.sources as string) || (q.source as string) || "";
            const sources = sourcesParam
                ? sourcesParam.split(",").map((s) => s.trim()).filter(Boolean)
                : undefined;

            const filters: WebhookLogListFilters = {
                direction: (q.direction as any) || undefined,
                sources,
                eventType: (q.eventType as string) || undefined,
                status: (q.status as any) || undefined,
                statusCode: q.statusCode ? parseInt(q.statusCode as string, 10) : undefined,
                fromDate: (q.fromDate as string) || undefined,
                toDate: (q.toDate as string) || undefined,
                search: (q.search as string) || undefined,
                page: q.page ? parseInt(q.page as string, 10) : 1,
                limit: q.limit ? parseInt(q.limit as string, 10) : 20,
            };

            const result = await webhookLogService.listLogs(filters);
            return res.status(200).json(result);
        } catch (err: any) {
            logger.error(`[WebhookLogController.list] ${err?.message}`);
            return res.status(500).json({ status: "error", message: "Failed to fetch webhook logs" });
        }
    };

    detail = async (req: Request, res: Response) => {
        try {
            const log = await webhookLogService.getLogById(req.params.id);
            if (!log) return res.status(404).json({ status: "error", message: "Log not found" });
            return res.status(200).json(log);
        } catch (err: any) {
            logger.error(`[WebhookLogController.detail] ${err?.message}`);
            return res.status(500).json({ status: "error", message: "Failed to fetch webhook log" });
        }
    };

    sources = async (_req: Request, res: Response) => {
        try {
            const sources = await webhookLogService.getDistinctSources();
            return res.status(200).json({ sources });
        } catch (err: any) {
            logger.error(`[WebhookLogController.sources] ${err?.message}`);
            return res.status(500).json({ status: "error", message: "Failed to fetch sources" });
        }
    };

    eventTypes = async (_req: Request, res: Response) => {
        try {
            const eventTypes = await webhookLogService.getDistinctEventTypes();
            return res.status(200).json({ eventTypes });
        } catch (err: any) {
            logger.error(`[WebhookLogController.eventTypes] ${err?.message}`);
            return res.status(500).json({ status: "error", message: "Failed to fetch event types" });
        }
    };
}
