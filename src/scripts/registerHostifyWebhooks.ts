import "dotenv/config";
import { Hostify } from "../client/Hostify";
import logger from "../utils/logger.utils";

/**
 * Idempotently register the SecureStay Hostify webhook(s).
 *
 * Hostify delivers webhooks via Amazon SNS and allows multiple webhooks per
 * notification type, so this does NOT disturb other integrations (e.g. Calry).
 *
 * The handler URL embeds ?auth=<HOSTIFY_WEBHOOK_AUTH_KEY> so our verifySession-free
 * webhook route can authenticate via the query string (SNS preserves it for both
 * the subscription confirmation and live notifications).
 *
 * Usage (prod):  NODE_ENV=production node dist/out-tsc/scripts/registerHostifyWebhooks.js
 *        (dev):  npx ts-node-dev src/scripts/registerHostifyWebhooks.ts
 *
 * Override which events to register with WEBHOOK_EVENTS (comma-separated).
 * Defaults to message_new only (the v2 inbox live-message path).
 */
async function main() {
    const apiKey = process.env.HOSTIFY_API_KEY;
    const auth = process.env.HOSTIFY_WEBHOOK_AUTH_KEY || process.env.HOSTIFY_WEBHOOK_SECRET;
    const base =
        process.env.WEBHOOK_PUBLIC_BASE_URL ||
        "https://securestay.ai/securestay_api/webhook/hostify_v1";

    if (!apiKey) throw new Error("HOSTIFY_API_KEY is not set");
    if (!auth) throw new Error("HOSTIFY_WEBHOOK_AUTH_KEY is not set");

    const events = (process.env.WEBHOOK_EVENTS || "message_new")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const url = `${base}?auth=${encodeURIComponent(auth)}`;
    const hostify = new Hostify();

    const existing = await hostify.listWebhooks(apiKey);
    const ours = existing.filter((w: any) => String(w?.endpoint || "").startsWith(base));
    logger.info(`[registerHostifyWebhooks] ${existing.length} total webhooks, ${ours.length} already ours`);

    for (const evt of events) {
        const already = ours.find((w: any) => w.action === evt && w.status === "confirmed");
        if (already) {
            logger.info(`[registerHostifyWebhooks] ${evt}: already registered (id ${already.id}) — skipping`);
            continue;
        }
        const res = await hostify.createWebhook(apiKey, { notificationType: evt, url, auth });
        if (res.success) {
            logger.info(`[registerHostifyWebhooks] ${evt}: created (id ${res.id})`);
        } else {
            logger.error(`[registerHostifyWebhooks] ${evt}: FAILED — ${res.error}`);
        }
    }

    logger.info("[registerHostifyWebhooks] done");
    process.exit(0);
}

main().catch((err) => {
    logger.error("[registerHostifyWebhooks] fatal:", err?.message || err);
    process.exit(1);
});
