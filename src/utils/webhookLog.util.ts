const HEADER_DENY_LIST = new Set<string>([
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-slack-signature",
    "stripe-signature",
    "x-hub-signature",
    "x-hub-signature-256",
    "x-hostify-signature",
    "x-webhook-secret",
    "x-webhook-token",
    "x-signature",
    "signature",
]);

const BODY_KEY_DENY_SUBSTRINGS = [
    "token",
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "access_key",
    "accesskey",
    "client_secret",
    "signing_key",
    "authorization",
    "credit_card",
    "creditcard",
    "card_number",
    "cardnumber",
    "cvv",
    "cvc",
    "ssn",
    "private_key",
    "privatekey",
    "refresh_token",
    "refreshtoken",
    "id_token",
    "idtoken",
    "bot_token",
    "bottoken",
    "signature",
];

const REDACTED = "[REDACTED]";
const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const MAX_DEPTH = 6;

const isDeniedKey = (key: string): boolean => {
    const lower = key.toLowerCase();
    return BODY_KEY_DENY_SUBSTRINGS.some((substr) => lower.includes(substr));
};

export function redactHeaders(headers: any): any {
    if (!headers || typeof headers !== "object") return headers;
    const out: Record<string, any> = {};
    for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (HEADER_DENY_LIST.has(lower)) {
            out[key] = REDACTED;
        } else {
            const value = (headers as any)[key];
            out[key] = typeof value === "string" ? value : safeStringify(value);
        }
    }
    return out;
}

function redactAny(value: any, depth: number): any {
    if (value === null || value === undefined) return value;
    if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
    if (Array.isArray(value)) {
        return value.map((item) => redactAny(item, depth + 1));
    }
    if (typeof value === "object") {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            if (isDeniedKey(key)) {
                out[key] = REDACTED;
            } else {
                out[key] = redactAny((value as any)[key], depth + 1);
            }
        }
        return out;
    }
    return value;
}

export function redactBody(body: any): any {
    if (body === null || body === undefined) return body;
    if (typeof body === "string") return body;
    return redactAny(body, 0);
}

export function redactQuery(query: any): any {
    return redactAny(query, 0);
}

export function truncate(str: string | null | undefined, max: number = DEFAULT_MAX_TEXT_BYTES): string | null {
    if (str === null || str === undefined) return null;
    if (str.length <= max) return str;
    const remaining = str.length - max;
    return str.slice(0, max) + `..[TRUNCATED_${remaining}_BYTES]`;
}

export function safeStringify(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_key, val) => {
            if (typeof val === "object" && val !== null) {
                if (seen.has(val)) return "[CIRCULAR]";
                seen.add(val);
            }
            if (typeof val === "bigint") return val.toString();
            return val;
        });
    } catch {
        return null;
    }
}

export function serializeBody(body: any): string | null {
    if (body === null || body === undefined) return null;
    if (typeof body === "string") return truncate(body);
    if (Buffer.isBuffer(body)) return truncate(body.toString("utf8"));
    const stringified = safeStringify(body);
    return truncate(stringified);
}

export function deriveSource(url: string): string {
    if (!url) return "other";
    const lower = url.toLowerCase();
    if (lower.includes("/webhook/zapier") || lower.includes("hooks.zapier.com")) return "zapier";
    if (lower.includes("/webhook/stripe") || lower.includes("api.stripe.com")) return "stripe";
    if (lower.includes("/webhook/hostify") || lower.includes("api.hostify.com")) return "hostify";
    if (lower.includes("/webhook/hostbuddy")) return "hostbuddy";
    if (lower.includes("charge-automation") || lower.includes("chargeautomation")) return "charge_automation";
    if (lower.includes("/webhook/ha-unified-webhook")) return "hostaway";
    if (lower.includes("/webhook/slack-events-webhook") || lower.includes("/webhook/slack-interactivity-webhook")) return "slack";
    return "other";
}

export function deriveEventType(body: any): string | null {
    if (!body) return null;
    // Text-parsed bodies (e.g. Hostify SNS) arrive as JSON strings — parse
    // shallowly so event_type/action still surface in the log.
    let obj: any = body;
    if (typeof body === "string") {
        try {
            obj = JSON.parse(body);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== "object") return null;
    const candidate =
        obj.event ?? obj.type ?? obj.event_type ?? obj.eventType ?? obj.action;
    if (typeof candidate === "string") return candidate.slice(0, 128);
    return null;
}
