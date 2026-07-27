import crypto from "crypto";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.utils";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";

type GoogleConversionInput = {
  conversionId: string;
  gclid?: string | null;
  email?: string | null;
  phone?: string | null;
  conversionTime?: string | Date;
  pageUrl?: string | null;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function readEnv(key: string): string {
  const fromProcess = String(process.env[key] || "").trim();
  if (fromProcess) return fromProcess;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    const text = fs.readFileSync(envPath, "utf8");
    const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
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
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return "";
  // Prefer E.164-ish US default when 10 digits.
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function customerId(): string {
  return readEnv("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "");
}

function conversionActionResource(): string | null {
  const explicit = readEnv("GOOGLE_ADS_CONVERSION_ACTION");
  if (explicit) return explicit;
  const actionId = readEnv("GOOGLE_ADS_CONVERSION_ACTION_ID");
  const cid = customerId();
  if (!actionId || !cid) return null;
  return `customers/${cid}/conversionActions/${actionId}`;
}

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 30_000) {
    return cachedAccessToken.token;
  }

  const clientId = readEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_ADS_CLIENT_SECRET");
  const refresh = readEnv("GOOGLE_ADS_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refresh) {
    logger.warn("[GoogleAds] Missing OAuth credentials; skipping conversion upload");
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!resp.ok || !json.access_token) {
    logger.error(`[GoogleAds] Token refresh failed: ${resp.status} ${JSON.stringify(json)}`);
    return null;
  }
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: now + Math.max(60, Number(json.expires_in || 3600)) * 1000,
  };
  return cachedAccessToken.token;
}

export class GoogleAdsConversionsService {
  static isConfigured(): boolean {
    return Boolean(
      readEnv("GOOGLE_ADS_DEVELOPER_TOKEN") &&
        readEnv("GOOGLE_ADS_CLIENT_ID") &&
        readEnv("GOOGLE_ADS_CLIENT_SECRET") &&
        readEnv("GOOGLE_ADS_REFRESH_TOKEN") &&
        customerId() &&
        conversionActionResource(),
    );
  }

  /**
   * Fire-and-forget lead upload for Google Ads optimization (gclid + enhanced conversions).
   */
  static sendLeadConversion(args: {
    conversionId?: string | null;
    gclid?: string | null;
    email?: string | null;
    phone?: string | null;
    pageUrl?: string | null;
  }): void {
    if (!args.gclid && !args.email && !args.phone) return;
    const conversionId =
      String(args.conversionId || "").trim() ||
      `ll_google_lead_${Date.now()}`;

    void this.uploadClickConversion({
      conversionId,
      gclid: args.gclid,
      email: args.email,
      phone: args.phone,
      pageUrl: args.pageUrl,
    }).catch((err) => {
      logger.error(`[GoogleAds] ${err?.message || err}`);
    });
  }

  static async uploadClickConversion(
    input: GoogleConversionInput,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, message: "not_configured" };
    }

    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, message: "no_access_token" };

    const cid = customerId();
    const action = conversionActionResource();
    if (!cid || !action) return { ok: false, message: "missing_customer_or_action" };

    const conversionDateTime =
      input.conversionTime instanceof Date
        ? formatAdsDateTime(input.conversionTime)
        : input.conversionTime
          ? formatAdsDateTime(new Date(input.conversionTime))
          : formatAdsDateTime(new Date());

    const conversion: Record<string, unknown> = {
      conversionAction: action,
      conversionDateTime,
      conversionValue: 1,
      currencyCode: "USD",
      orderId: input.conversionId,
    };
    if (input.gclid) conversion.gclid = String(input.gclid);

    const userIdentifiers: Array<Record<string, unknown>> = [];
    if (input.email) {
      userIdentifiers.push({
        hashedEmail: sha256Hex(normalizeEmail(input.email)),
      });
    }
    if (input.phone) {
      const phone = normalizePhone(input.phone);
      if (phone) {
        userIdentifiers.push({
          hashedPhoneNumber: sha256Hex(phone),
        });
      }
    }
    if (userIdentifiers.length) {
      conversion.userIdentifiers = userIdentifiers;
    }

    const developerToken = readEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = readEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, "");

    const url = `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${cid}:uploadClickConversions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({
        conversions: [conversion],
        partialFailure: true,
      }),
    });

    const text = await resp.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!resp.ok) {
      logger.error(`[GoogleAds] upload failed ${resp.status}: ${text.slice(0, 800)}`);
      return { ok: false, message: text.slice(0, 300) };
    }

    if (parsed?.partialFailureError) {
      logger.error(
        `[GoogleAds] partial failure: ${JSON.stringify(parsed.partialFailureError).slice(0, 800)}`,
      );
      return { ok: false, message: "partial_failure" };
    }

    logger.info(`[GoogleAds] Lead conversion uploaded orderId=${input.conversionId}`);
    return { ok: true, message: "uploaded" };
  }
}

function formatAdsDateTime(d: Date): string {
  // Google Ads expects "yyyy-mm-dd hh:mm:ss+|-hh:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const abs = Math.abs(tz);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}
