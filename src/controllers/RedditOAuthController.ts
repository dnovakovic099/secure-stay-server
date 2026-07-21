import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.utils";

const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
// Reddit Ads OAuth requires a comma-separated scope list.
// Note: adsleadgendownloader was removed from Reddit's authorize scopes (v3),
// so lead download via API is no longer grantable — use Zapier Reddit Lead Ads.
const DEFAULT_SCOPES = "adsread,adsedit,adsconversions";

function redditRedirectUri(): string {
  const configured = String(process.env.REDDIT_REDIRECT_URI || "").trim();
  if (configured) return configured;
  // Production API is mounted at /securestay_api behind nginx.
  const base = String(process.env.BASE_URL || "https://securestay.ai/securestay_api").replace(/\/$/, "");
  return `${base}/oauth/reddit/callback`;
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
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

export class RedditOAuthController {
  /**
   * GET /oauth/reddit/status
   * Reports whether Reddit OAuth refresh token is configured (no secrets leaked).
   */
  status = async (_req: Request, res: Response) => {
    // Prefer live process env, but also read .env because OAuth callback may
    // persist a refresh token without a PM2 reload.
    let envRefresh = "";
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      const text = fs.readFileSync(envPath, "utf8");
      const match = text.match(/^REDDIT_REFRESH_TOKEN=(.+)$/m);
      envRefresh = match?.[1]?.trim() || "";
    } catch {
      envRefresh = "";
    }
    const hasClient = Boolean(String(process.env.REDDIT_CLIENT_ID || "").trim());
    const hasSecret = Boolean(String(process.env.REDDIT_CLIENT_SECRET || "").trim());
    const hasRefresh = Boolean(String(process.env.REDDIT_REFRESH_TOKEN || "").trim() || envRefresh);
    return res.json({
      configured: hasClient && hasSecret && hasRefresh,
      has_client_id: hasClient,
      has_client_secret: hasSecret,
      has_refresh_token: hasRefresh,
      redirect_uri: redditRedirectUri(),
      authorize_url: "/oauth/reddit/authorize",
    });
  };

  /**
   * GET /oauth/reddit/authorize
   * Starts the Reddit Ads OAuth consent flow.
   */
  authorize = async (req: Request, res: Response) => {
    const clientId = String(process.env.REDDIT_CLIENT_ID || "").trim();
    if (!clientId) {
      return res
        .status(500)
        .send(htmlPage("Reddit OAuth not configured", "<p>Set <code>REDDIT_CLIENT_ID</code> in the server environment.</p>"));
    }

    const redirectUri = redditRedirectUri();
    const state = String(req.query.state || `ss_${Date.now()}`);
    const scope = String(process.env.REDDIT_OAUTH_SCOPES || DEFAULT_SCOPES);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      state,
      redirect_uri: redirectUri,
      duration: "permanent",
      scope,
    });

    return res.redirect(`${REDDIT_AUTHORIZE_URL}?${params.toString()}`);
  };

  /**
   * GET /oauth/reddit/callback
   * Reddit redirects here after the user approves the app.
   */
  callback = async (req: Request, res: Response) => {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error) {
      logger.error(`[RedditOAuth] Authorization denied: ${error}`);
      return res
        .status(400)
        .send(htmlPage("Reddit authorization failed", `<p>Error: <code>${error}</code></p>`));
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) {
      return res
        .status(400)
        .send(htmlPage("Missing authorization code", "<p>Reddit did not return a <code>code</code> parameter.</p>"));
    }

    const clientId = String(process.env.REDDIT_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.REDDIT_CLIENT_SECRET || "").trim();
    const redirectUri = redditRedirectUri();

    if (!clientId || !clientSecret) {
      logger.info(`[RedditOAuth] Received code (credentials not set, skipping token exchange). state=${req.query.state}`);
      return res.send(
        htmlPage(
          "Reddit authorization code received",
          `<p>Code received. Add <code>REDDIT_CLIENT_ID</code> and <code>REDDIT_CLIENT_SECRET</code> to the server env, then restart the authorize flow to exchange for tokens.</p>
           <p>Redirect URI for the Reddit app: <code>${redirectUri}</code></p>`
        )
      );
    }

    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch(REDDIT_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": process.env.REDDIT_USER_AGENT || "SecureStay/1.0",
        },
        body: body.toString(),
      });

      const tokenJson: any = await tokenRes.json();
      if (!tokenRes.ok) {
        logger.error(`[RedditOAuth] Token exchange failed: ${JSON.stringify(tokenJson)}`);
        return res
          .status(502)
          .send(htmlPage("Token exchange failed", `<p>Reddit rejected the token request. Check server logs.</p>`));
      }

      // Never render tokens in the browser; persist refresh token to .env for API jobs.
      logger.info(
        `[RedditOAuth] Token exchange succeeded. access_token_len=${String(tokenJson.access_token || "").length} refresh_token_present=${Boolean(tokenJson.refresh_token)} scope=${tokenJson.scope || ""}`
      );
      if (tokenJson.refresh_token) {
        try {
          upsertEnvVar("REDDIT_REFRESH_TOKEN", String(tokenJson.refresh_token));
          logger.info("[RedditOAuth] Persisted REDDIT_REFRESH_TOKEN to .env");
        } catch (persistErr: any) {
          logger.error(`[RedditOAuth] Failed to persist refresh token: ${persistErr?.message || persistErr}`);
          logger.info(`[RedditOAuth] REDDIT_REFRESH_TOKEN=${tokenJson.refresh_token}`);
        }
      }

      return res.send(
        htmlPage(
          "Reddit connected to SecureStay",
          `<p>Authorization succeeded. You can close this tab.</p>
           <p>Refresh token was saved on the server. Tell Cursor to create the Reddit ads next.</p>`
        )
      );
    } catch (err: any) {
      logger.error(`[RedditOAuth] Token exchange error: ${err?.message || err}`);
      return res
        .status(500)
        .send(htmlPage("Token exchange error", "<p>Something went wrong exchanging the code. Check server logs.</p>"));
    }
  };
}
