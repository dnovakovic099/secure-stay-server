import crypto from "crypto";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.utils";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const CAPI_BASE = "https://ads-api.reddit.com/api/v2.0/conversions/events";
const DEFAULT_PIXEL_ID = "a2_ih4m3qbk6tej";
const USER_AGENT = process.env.REDDIT_USER_AGENT || "SecureStay/1.0";

type TrackingType = "PageVisit" | "Lead" | "SignUp" | "Custom" | "ViewContent";

export type RedditConversionInput = {
  trackingType: TrackingType;
  eventAt?: string | Date;
  conversionId: string;
  clickId?: string | null;
  pageUrl?: string | null;
  visitorId?: string | null;
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  rdtUuid?: string | null;
  customEventName?: string | null;
  testMode?: boolean;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function readEnvRefreshToken(): string {
  const fromProcess = String(process.env.REDDIT_REFRESH_TOKEN || "").trim();
  if (fromProcess) return fromProcess;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    const text = fs.readFileSync(envPath, "utf8");
    const match = text.match(/^REDDIT_REFRESH_TOKEN=(.+)$/m);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  // Digits only; keep leading country code if present.
  return phone.replace(/\D+/g, "");
}

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 30_000) {
    return cachedAccessToken.token;
  }

  const clientId = String(process.env.REDDIT_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.REDDIT_CLIENT_SECRET || "").trim();
  const refresh = readEnvRefreshToken();
  if (!clientId || !clientSecret || !refresh) {
    logger.warn("[RedditCAPI] Missing OAuth credentials; skipping conversion send");
    return null;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  const json = (await resp.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!resp.ok || !json.access_token) {
    logger.error(`[RedditCAPI] Token refresh failed: ${resp.status} ${JSON.stringify(json)}`);
    return null;
  }
  if (json.refresh_token) {
    process.env.REDDIT_REFRESH_TOKEN = json.refresh_token;
  }
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: now + Math.max(60, Number(json.expires_in || 3600)) * 1000,
  };
  return json.access_token;
}

function mapLandingEvent(eventName: string): {
  trackingType: TrackingType;
  customEventName?: string;
} | null {
  switch (eventName) {
    case "page_view":
      return { trackingType: "PageVisit" };
    case "lead_submit":
      return { trackingType: "Lead" };
    // Intentional: do not send qualify_open / cta_click to Reddit.
    // Reddit traffic auto-opens the modal, so qualify_open is not a real
    // intent signal and would pollute optimization. Only Lead on submit.
    default:
      return null;
  }
}

export class RedditConversionsService {
  static pixelId(): string {
    return String(process.env.REDDIT_PIXEL_ID || DEFAULT_PIXEL_ID).trim() || DEFAULT_PIXEL_ID;
  }

  static mapFromLandingEvent(eventName: string) {
    return mapLandingEvent(eventName);
  }

  /**
   * Fire-and-forget safe wrapper used by the public landing beacon.
   */
  static sendFromLandingEvent(args: {
    eventName: string;
    conversionId?: string | null;
    clickId?: string | null;
    pageUrl?: string | null;
    visitorId?: string | null;
    email?: string | null;
    phone?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    rdtUuid?: string | null;
    props?: Record<string, unknown>;
  }): void {
    const mapped = mapLandingEvent(args.eventName);
    if (!mapped) return;

    const conversionId =
      String(args.conversionId || args.props?.conversion_id || "").trim() ||
      `ll_${args.eventName}_${args.visitorId || "anon"}_${Date.now()}`;

    void this.sendEvent({
      trackingType: mapped.trackingType,
      customEventName: mapped.customEventName,
      conversionId,
      clickId: args.clickId,
      pageUrl: args.pageUrl,
      visitorId: args.visitorId,
      email: args.email,
      phone: args.phone,
      ip: args.ip,
      userAgent: args.userAgent,
      rdtUuid: args.rdtUuid,
      testMode: String(process.env.REDDIT_CAPI_TEST_MODE || "").toLowerCase() === "true",
    }).catch((err) => {
      logger.error(`[RedditCAPI] ${err?.message || err}`);
    });
  }

  static async sendEvent(input: RedditConversionInput): Promise<{ ok: boolean; message?: string }> {
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, message: "no_access_token" };

    const pixelId = this.pixelId();
    const eventAt =
      input.eventAt instanceof Date
        ? input.eventAt.toISOString()
        : String(input.eventAt || new Date().toISOString());

    const user: Record<string, unknown> = {};
    if (input.email) user.email = sha256Hex(normalizeEmail(input.email));
    if (input.phone) {
      const digits = normalizePhone(input.phone);
      if (digits) user.phone_number = sha256Hex(digits);
    }
    if (input.visitorId) user.external_id = sha256Hex(String(input.visitorId));
    if (input.ip) user.ip_address = input.ip;
    if (input.userAgent) user.user_agent = input.userAgent;
    if (input.rdtUuid) user.uuid = input.rdtUuid;

    const eventType: Record<string, string> = { tracking_type: input.trackingType };
    if (input.trackingType === "Custom" && input.customEventName) {
      eventType.custom_event_name = input.customEventName;
    }

    const event: Record<string, unknown> = {
      event_at: eventAt.endsWith("Z") ? eventAt : new Date(eventAt).toISOString(),
      event_type: eventType,
      event_metadata: {
        conversion_id: input.conversionId,
      },
    };
    if (input.clickId) event.click_id = input.clickId;
    if (Object.keys(user).length) event.user = user;

    const payload: Record<string, unknown> = { events: [event] };
    if (input.testMode) payload.test_mode = true;

    const resp = await fetch(`${CAPI_BASE}/${encodeURIComponent(pixelId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let message = text;
    try {
      message = JSON.parse(text)?.message || text;
    } catch {
      /* keep raw */
    }

    if (!resp.ok) {
      logger.error(`[RedditCAPI] ${resp.status} ${message}`);
      return { ok: false, message: String(message) };
    }

    logger.info(`[RedditCAPI] ${input.trackingType} ok: ${message}`);
    return { ok: true, message: String(message) };
  }
}
