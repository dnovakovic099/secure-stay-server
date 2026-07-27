import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import logger from "../utils/logger.utils";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SCOPES = "https://www.googleapis.com/auth/adwords";

function googleRedirectUri(): string {
  const configured = String(process.env.GOOGLE_ADS_REDIRECT_URI || "").trim();
  if (configured) return configured;
  const base = String(process.env.BASE_URL || "https://securestay.ai/securestay_api").replace(
    /\/$/,
    "",
  );
  return `${base}/oauth/google-ads/callback`;
}

function upsertEnvVar(key: string, value: string): void {
  const envPath = path.resolve(process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) return line;
    const k = line.split("=", 1)[0].trim();
    if (k !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"), "utf8");
  process.env[key] = value;
}

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

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #111; line-height: 1.5; }
    h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    code { background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    ol { color: #444; padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

export class GoogleAdsOAuthController {
  /**
   * GET /oauth/google-ads/status
   */
  status = async (_req: Request, res: Response) => {
    const hasClient = Boolean(readEnv("GOOGLE_ADS_CLIENT_ID"));
    const hasSecret = Boolean(readEnv("GOOGLE_ADS_CLIENT_SECRET"));
    const hasRefresh = Boolean(readEnv("GOOGLE_ADS_REFRESH_TOKEN"));
    const hasDeveloper = Boolean(readEnv("GOOGLE_ADS_DEVELOPER_TOKEN"));
    const hasCustomer = Boolean(readEnv("GOOGLE_ADS_CUSTOMER_ID"));
    const hasAction = Boolean(
      readEnv("GOOGLE_ADS_CONVERSION_ACTION") || readEnv("GOOGLE_ADS_CONVERSION_ACTION_ID"),
    );
    return res.json({
      configured: hasClient && hasSecret && hasRefresh && hasDeveloper && hasCustomer && hasAction,
      has_client_id: hasClient,
      has_client_secret: hasSecret,
      has_refresh_token: hasRefresh,
      has_developer_token: hasDeveloper,
      has_customer_id: hasCustomer,
      has_conversion_action: hasAction,
      redirect_uri: googleRedirectUri(),
      authorize_url: "/oauth/google-ads/authorize",
    });
  };

  /**
   * GET /oauth/google-ads/authorize
   */
  authorize = async (req: Request, res: Response) => {
    const clientId = readEnv("GOOGLE_ADS_CLIENT_ID");
    if (!clientId) {
      return res.status(500).send(
        htmlPage(
          "Google Ads OAuth not configured",
          `<p>Set these on the server, then retry:</p>
           <ol>
             <li><code>GOOGLE_ADS_CLIENT_ID</code> / <code>GOOGLE_ADS_CLIENT_SECRET</code> (Google Cloud OAuth desktop/web client)</li>
             <li><code>GOOGLE_ADS_DEVELOPER_TOKEN</code> from Google Ads API Center</li>
             <li><code>GOOGLE_ADS_CUSTOMER_ID</code> (10-digit account id)</li>
           </ol>
           <p>Redirect URI to allowlist: <code>${googleRedirectUri()}</code></p>`,
        ),
      );
    }

    const redirectUri = googleRedirectUri();
    const state = String(req.query.state || `gads_${crypto.randomBytes(8).toString("hex")}`);
    const scope = String(process.env.GOOGLE_ADS_OAUTH_SCOPES || DEFAULT_SCOPES);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: "true",
    });
    return res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  };

  /**
   * GET /oauth/google-ads/callback
   */
  callback = async (req: Request, res: Response) => {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error) {
      logger.error(`[GoogleAdsOAuth] Authorization denied: ${error}`);
      return res
        .status(400)
        .send(htmlPage("Google Ads authorization failed", `<p>Error: <code>${error}</code></p>`));
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) {
      return res
        .status(400)
        .send(htmlPage("Missing authorization code", "<p>Google did not return a <code>code</code>.</p>"));
    }

    const clientId = readEnv("GOOGLE_ADS_CLIENT_ID");
    const clientSecret = readEnv("GOOGLE_ADS_CLIENT_SECRET");
    const redirectUri = googleRedirectUri();
    if (!clientId || !clientSecret) {
      return res.status(500).send(
        htmlPage(
          "Missing Google OAuth client credentials",
          "<p>Set <code>GOOGLE_ADS_CLIENT_ID</code> and <code>GOOGLE_ADS_CLIENT_SECRET</code> first.</p>",
        ),
      );
    }

    try {
      const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const tokenJson: any = await tokenRes.json();
      if (!tokenRes.ok) {
        logger.error(`[GoogleAdsOAuth] Token exchange failed: ${JSON.stringify(tokenJson)}`);
        return res
          .status(502)
          .send(htmlPage("Token exchange failed", "<p>Google rejected the token request. Check server logs.</p>"));
      }

      logger.info(
        `[GoogleAdsOAuth] Token exchange succeeded. refresh_token_present=${Boolean(tokenJson.refresh_token)}`,
      );
      if (tokenJson.refresh_token) {
        try {
          upsertEnvVar("GOOGLE_ADS_REFRESH_TOKEN", String(tokenJson.refresh_token));
          logger.info("[GoogleAdsOAuth] Persisted GOOGLE_ADS_REFRESH_TOKEN to .env");
        } catch (persistErr: any) {
          logger.error(`[GoogleAdsOAuth] Failed to persist refresh token: ${persistErr?.message || persistErr}`);
        }
      }

      return res.send(
        htmlPage(
          "Google Ads connected to SecureStay",
          `<p>Authorization succeeded. You can close this tab.</p>
           <p>Next: set <code>GOOGLE_ADS_CUSTOMER_ID</code> + conversion action, then run <code>scripts/createGoogleLeadAds.py</code>.</p>`,
        ),
      );
    } catch (err: any) {
      logger.error(`[GoogleAdsOAuth] Token exchange error: ${err?.message || err}`);
      return res
        .status(500)
        .send(htmlPage("Token exchange error", "<p>Something went wrong. Check server logs.</p>"));
    }
  };
}
