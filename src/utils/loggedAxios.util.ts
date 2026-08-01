import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { webhookLogService } from "../services/WebhookLogService";
import {
    deriveEventType,
    deriveSource,
    redactBody,
    redactHeaders,
    redactQuery,
    serializeBody,
} from "../utils/webhookLog.util";

interface WithLogMeta extends InternalAxiosRequestConfig {
    __logStart?: number;
    __logSourceOverride?: string;
}

function buildFullUrl(config: AxiosRequestConfig): string {
    const base = config.baseURL || "";
    const url = config.url || "";
    if (/^https?:\/\//i.test(url)) return url;
    if (!base) return url;
    return base.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
}

function logAxiosCall(
    config: WithLogMeta | undefined,
    response: AxiosResponse | undefined,
    error: AxiosError | null,
    sourceOverride?: string,
) {
    try {
        if (!config) return;
        const startedAt = config.__logStart ?? Date.now();
        const durationMs = Date.now() - startedAt;
        const fullUrl = buildFullUrl(config);
        const source = sourceOverride || config.__logSourceOverride || deriveSource(fullUrl);
        const statusCode = response?.status ?? error?.response?.status ?? null;

        webhookLogService.writeLog({
            direction: "outgoing",
            source,
            eventType: deriveEventType(config.data),
            url: fullUrl,
            method: (config.method || "GET").toUpperCase(),
            statusCode,
            requestHeaders: redactHeaders(config.headers || {}),
            requestQuery: redactQuery(config.params || {}),
            requestBody: serializeBody(redactBody(config.data)),
            responseHeaders: redactHeaders(response?.headers || error?.response?.headers || {}),
            responseBody: serializeBody(redactBody(response?.data ?? error?.response?.data)),
            durationMs,
            errorMessage: error ? (error.message || String(error)) : (statusCode && statusCode >= 400 ? `HTTP ${statusCode}` : null),
        });
    } catch {
        // logging must never break the caller
    }
}

/**
 * Create an axios instance that logs every outgoing request/response
 * to the webhook_logs table. Failures inside the interceptor are swallowed.
 */
export function createLoggedAxios(source?: string): AxiosInstance {
    const instance = axios.create();

    instance.interceptors.request.use((config) => {
        (config as WithLogMeta).__logStart = Date.now();
        if (source) (config as WithLogMeta).__logSourceOverride = source;
        return config;
    });

    instance.interceptors.response.use(
        (response) => {
            logAxiosCall(response.config as WithLogMeta, response, null, source);
            return response;
        },
        (error: AxiosError) => {
            logAxiosCall(error.config as WithLogMeta, undefined, error, source);
            return Promise.reject(error);
        },
    );

    return instance;
}
