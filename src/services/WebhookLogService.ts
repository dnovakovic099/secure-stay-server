import { Brackets, LessThan } from "typeorm";
import { WebhookDirection, WebhookLog } from "../entity/WebhookLog";
import { appDatabase } from "../utils/database.util";
import { runAsync } from "../utils/asyncUtils";
import logger from "../utils/logger.utils";

export interface WebhookLogInput {
    direction: WebhookDirection;
    source: string;
    eventType?: string | null;
    url: string;
    method: string;
    statusCode?: number | null;
    requestHeaders?: any;
    requestQuery?: any;
    requestBody?: string | null;
    responseHeaders?: any;
    responseBody?: string | null;
    durationMs?: number | null;
    errorMessage?: string | null;
    remoteIp?: string | null;
}

export interface WebhookLogListFilters {
    direction?: WebhookDirection;
    source?: string;
    sources?: string[];
    eventType?: string;
    status?: "success" | "error" | "all";
    statusCode?: number;
    fromDate?: string;
    toDate?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export class WebhookLogService {
    /**
     * Fire-and-forget write. Never awaited from the request path.
     * Failures are logged but never thrown.
     */
    writeLog(input: WebhookLogInput): void {
        if (!appDatabase.isInitialized) return;
        const repo = appDatabase.getRepository(WebhookLog);
        const record = repo.create({
            direction: input.direction,
            source: input.source || "other",
            eventType: input.eventType ?? null,
            url: (input.url ?? "").slice(0, 1024),
            method: (input.method ?? "").slice(0, 10),
            statusCode: input.statusCode ?? null,
            requestHeaders: input.requestHeaders ?? null,
            requestQuery: input.requestQuery ?? null,
            requestBody: input.requestBody ?? null,
            responseHeaders: input.responseHeaders ?? null,
            responseBody: input.responseBody ?? null,
            durationMs: input.durationMs ?? null,
            errorMessage: input.errorMessage ?? null,
            remoteIp: input.remoteIp ?? null,
        });
        runAsync(repo.insert(record).then(() => undefined), "WebhookLog.insert");
    }

    async listLogs(filters: WebhookLogListFilters) {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

        const repo = appDatabase.getRepository(WebhookLog);
        const qb = repo.createQueryBuilder("log");

        if (filters.direction) qb.andWhere("log.direction = :direction", { direction: filters.direction });
        if (filters.sources && filters.sources.length > 0) {
            qb.andWhere("log.source IN (:...sources)", { sources: filters.sources });
        } else if (filters.source) {
            qb.andWhere("log.source = :source", { source: filters.source });
        }
        if (filters.eventType) qb.andWhere("log.eventType = :eventType", { eventType: filters.eventType });

        if (filters.status === "success") {
            qb.andWhere("log.statusCode >= 200 AND log.statusCode < 400");
        } else if (filters.status === "error") {
            qb.andWhere("(log.statusCode >= 400 OR log.statusCode IS NULL OR log.errorMessage IS NOT NULL)");
        }
        if (filters.statusCode) qb.andWhere("log.statusCode = :statusCode", { statusCode: filters.statusCode });

        if (filters.fromDate) qb.andWhere("log.createdAt >= :fromDate", { fromDate: filters.fromDate });
        if (filters.toDate) qb.andWhere("log.createdAt <= :toDate", { toDate: filters.toDate });

        if (filters.search) {
            const like = `%${filters.search}%`;
            qb.andWhere(new Brackets((b) => {
                b.where("log.url LIKE :like", { like })
                    .orWhere("log.eventType LIKE :like", { like })
                    .orWhere("log.requestBody LIKE :like", { like })
                    .orWhere("log.responseBody LIKE :like", { like })
                    .orWhere("log.errorMessage LIKE :like", { like });
            }));
        }

        qb.orderBy("log.createdAt", "DESC")
            .skip((page - 1) * limit)
            .take(limit);

        const [items, total] = await qb.getManyAndCount();
        return {
            items,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }

    async getLogById(id: string | number) {
        const repo = appDatabase.getRepository(WebhookLog);
        return repo.findOne({ where: { id: String(id) as any } });
    }

    async getDistinctSources(): Promise<string[]> {
        const repo = appDatabase.getRepository(WebhookLog);
        const rows = await repo.createQueryBuilder("log")
            .select("DISTINCT log.source", "source")
            .getRawMany();
        return rows.map((r) => r.source).filter(Boolean).sort();
    }

    async getDistinctEventTypes(): Promise<string[]> {
        const repo = appDatabase.getRepository(WebhookLog);
        const rows = await repo.createQueryBuilder("log")
            .select("DISTINCT log.eventType", "eventType")
            .where("log.eventType IS NOT NULL")
            .getRawMany();
        return rows.map((r) => r.eventType).filter(Boolean).sort();
    }

    /**
     * Deletes rows older than the retention window. Called by scheduler.
     */
    async cleanupOldLogs(retentionDays: number = 15): Promise<number> {
        if (!appDatabase.isInitialized) return 0;
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        try {
            const repo = appDatabase.getRepository(WebhookLog);
            const result = await repo.delete({ createdAt: LessThan(cutoff) });
            const affected = result.affected ?? 0;
            logger.info(`[WebhookLogService.cleanupOldLogs] Deleted ${affected} rows older than ${cutoff.toISOString()}`);
            return affected;
        } catch (err: any) {
            logger.error(`[WebhookLogService.cleanupOldLogs] Error: ${err?.message}`);
            return 0;
        }
    }
}

export const webhookLogService = new WebhookLogService();
