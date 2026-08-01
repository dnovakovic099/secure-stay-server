import { NextFunction, Request, Response } from "express";
import { webhookLogService } from "../services/WebhookLogService";
import {
    deriveEventType,
    deriveSource,
    redactBody,
    redactHeaders,
    redactQuery,
    safeStringify,
    serializeBody,
    truncate,
} from "../utils/webhookLog.util";

/**
 * Captures request/response for incoming webhook endpoints.
 * Persists the log after res.finish so latency is not affected.
 * Skips logging its own /webhook/webhook-logs endpoints to avoid recursion.
 */
const SKIP_URL_SUBSTRINGS = [
    "/webhook/webhook-logs",
    "/webhook/slack-events-webhook",
];

export function webhookLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const originalUrl = req.originalUrl || "";
        if (SKIP_URL_SUBSTRINGS.some((s) => originalUrl.includes(s))) {
            return next();
        }

        const startedAt = Date.now();
        const method = req.method;
        const url = req.originalUrl || req.url;
        const requestHeaders = redactHeaders(req.headers);
        const requestQuery = redactQuery(req.query);
        const requestBody = serializeBody(redactBody(req.body));
        const remoteIp = (req.ip || (req.socket && req.socket.remoteAddress) || null) as string | null;

        let responseBodyCaptured: string | null = null;

        const originalJson = res.json.bind(res);
        res.json = ((body: any) => {
            try {
                responseBodyCaptured = serializeBody(redactBody(body));
            } catch {
                responseBodyCaptured = null;
            }
            return originalJson(body);
        }) as any;

        const originalSend = res.send.bind(res);
        res.send = ((body: any) => {
            try {
                if (responseBodyCaptured === null) {
                    if (typeof body === "string") {
                        responseBodyCaptured = truncate(body);
                    } else if (Buffer.isBuffer(body)) {
                        responseBodyCaptured = truncate(body.toString("utf8"));
                    } else {
                        responseBodyCaptured = truncate(safeStringify(redactBody(body)) || "");
                    }
                }
            } catch {
                // ignore
            }
            return originalSend(body);
        }) as any;

        res.on("finish", () => {
            try {
                const responseHeaders = redactHeaders(res.getHeaders());
                webhookLogService.writeLog({
                    direction: "incoming",
                    source: deriveSource(url),
                    eventType: deriveEventType(req.body),
                    url,
                    method,
                    statusCode: res.statusCode,
                    requestHeaders,
                    requestQuery,
                    requestBody,
                    responseHeaders,
                    responseBody: responseBodyCaptured,
                    durationMs: Date.now() - startedAt,
                    errorMessage: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
                    remoteIp,
                });
            } catch {
                // Never let logging break the response
            }
        });
    } catch {
        // If anything fails setting up capture, continue without logging
    }
    next();
}
