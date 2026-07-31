import axios from "axios";
import crypto from "crypto";
import logger from "../utils/logger.utils";

/**
 * Sifely Open API auth (cus-openapi.sifely.com).
 *
 * Login returns a long-lived `clientToken` (sk-…) that is used as the raw
 * Authorization header — not a Bearer OAuth token. Prefer SIFELY_API_KEY when
 * set so we do not re-login on every process start.
 */
export interface SifelyTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  client_id?: string;
}

export class SifelyAuthService {
  private openApiUrl: string;
  private apiKey: string;
  private username: string;
  private password: string;
  private appName: string;

  private accessToken: string | null = null;
  private clientId: string | null = null;

  constructor() {
    this.openApiUrl =
      process.env.SIFELY_OPENAPI_URL || "https://cus-openapi.sifely.com";
    this.apiKey = (process.env.SIFELY_API_KEY || "").trim();
    this.username = process.env.SIFELY_USERNAME || "";
    this.password = process.env.SIFELY_PASSWORD || "";
    // Their developer portal sends this header; without it, accounts that are
    // on DEVELOPER (or unsubscribed) with >5 locks get HTTP 402/50504 on every
    // device call. Harmless once Starter is active.
    this.appName =
      process.env.SIFELY_APP_NAME !== undefined
        ? process.env.SIFELY_APP_NAME
        : "subscriptions_portal";
  }

  private hashPassword(password: string): string {
    return crypto.createHash("md5").update(password).digest("hex");
  }

  isConfigured(): boolean {
    return !!this.apiKey || (!!this.username && !!this.password);
  }

  /**
   * Headers for every Open API call. Authorization is the raw sk- key.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getValidAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: token,
    };
    if (this.appName) {
      headers["X-App-Name"] = this.appName;
    }
    return headers;
  }

  async getValidAccessToken(): Promise<string> {
    if (this.apiKey) {
      this.accessToken = this.apiKey;
      return this.apiKey;
    }
    if (this.accessToken) return this.accessToken;
    const tokens = await this.login();
    return tokens.access_token;
  }

  async login(): Promise<SifelyTokenResponse> {
    if (this.apiKey) {
      const tokens: SifelyTokenResponse = {
        access_token: this.apiKey,
        expires_in: 365 * 24 * 3600,
        refresh_token: "",
        token_type: "api_key",
      };
      this.accessToken = this.apiKey;
      return tokens;
    }

    if (!this.username || !this.password) {
      throw new Error(
        "Sifely credentials not configured. Set SIFELY_API_KEY or SIFELY_USERNAME/SIFELY_PASSWORD."
      );
    }

    const hashedPassword = this.hashPassword(this.password);
    logger.info(`Attempting Sifely Open API login for user: ${this.username}`);

    try {
      const response = await axios.post(
        `${this.openApiUrl}/system/smart/login`,
        {
          account: this.username,
          password: hashedPassword,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30_000,
        }
      );

      const raw = response.data?.data || response.data;
      const token = raw?.clientToken || raw?.token || raw?.access_token;
      if (!token) {
        throw new Error(
          response.data?.message || "Sifely login returned no clientToken"
        );
      }

      this.accessToken = token;
      this.clientId = raw?.clientId || null;
      if (raw?.clientId && !process.env.SIFELY_CLIENT_ID) {
        // Keep in-memory only; deploy secrets remain the source of truth.
        process.env.SIFELY_CLIENT_ID = raw.clientId;
      }

      logger.info(
        `Sifely Open API login ok (plan=${raw?.plan || "unknown"}, locks=${raw?.lockNum ?? "?"})`
      );

      return {
        access_token: token,
        expires_in: 365 * 24 * 3600,
        refresh_token: "",
        token_type: "api_key",
        client_id: raw?.clientId,
      };
    } catch (error: any) {
      if (error.response) {
        logger.error(
          `Sifely login failed - Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`
        );
      } else {
        logger.error(`Sifely login failed: ${error.message}`);
      }
      throw error;
    }
  }

  async refreshAccessToken(): Promise<SifelyTokenResponse> {
    // Open API keys do not refresh; re-login only when using username/password.
    this.accessToken = null;
    return this.login();
  }

  async getAxiosConfig(): Promise<object> {
    return { headers: await this.getAuthHeaders() };
  }
}
