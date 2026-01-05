import axios from "axios";
import crypto from "crypto";
import logger from "../utils/logger.utils";

/**
 * Sifely OAuth Token Response
 */
export interface SifelyTokenResponse {
  access_token: string;
  expires_in: number; // seconds (typically 7200)
  refresh_token: string;
  token_type: string;
}

/**
 * Sifely Authentication Service
 * Handles OAuth2 token management for Sifely API
 * All credentials are read from environment variables
 */
export class SifelyAuthService {
  private baseUrl: string;
  private clientId: string;
  private username: string;
  private password: string;

  // Token storage
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.baseUrl = process.env.SIFELY_BASE_URL || "https://dev-alexa.sifely.com";
    this.clientId = process.env.SIFELY_CLIENT_ID || "";
    this.username = process.env.SIFELY_USERNAME || "";
    this.password = process.env.SIFELY_PASSWORD || "";
  }

  /**
   * Hash password with MD5 (required by Sifely API)
   */
  private hashPassword(password: string): string {
    return crypto.createHash("md5").update(password).digest("hex");
  }

  /**
   * Login with username and password from environment variables
   */
  async login(): Promise<SifelyTokenResponse> {
    if (!this.username || !this.password || !this.clientId) {
      throw new Error("Sifely credentials not configured. Please set SIFELY_CLIENT_ID, SIFELY_USERNAME, and SIFELY_PASSWORD in .env");
    }

    try {
      // Sifely API requires MD5 hashed password
      const hashedPassword = this.hashPassword(this.password);

      logger.info(`Attempting Sifely login for user: ${this.username}`);

      const response = await axios.post(
        `${this.baseUrl}/system/smart/login`,
        null,
        {
          params: {
            client_id: this.clientId,
            username: this.username,
            password: hashedPassword,
          },
        }
      );

      logger.info(`Sifely login response code: ${response.data.code}`);
      logger.info(`Sifely login response data keys: ${JSON.stringify(Object.keys(response.data))}`);
      logger.info(`Sifely login response.data.data: ${JSON.stringify(response.data.data)}`);

      // Sifely API returns code 200 or 0 for success
      if (response.data.code !== undefined && response.data.code !== 0 && response.data.code !== 200) {
        throw new Error(response.data.message || `Login failed with code: ${response.data.code}`);
      }

      // Sifely returns 'token' and 'refreshToken' (not access_token/refresh_token)
      const rawData = response.data.data || response.data;
      const tokens: SifelyTokenResponse = {
        access_token: rawData.token || rawData.access_token,
        refresh_token: rawData.refreshToken || rawData.refresh_token,
        expires_in: rawData.expires_in || 7200, // Default to 2 hours
        token_type: rawData.token_type || "Bearer",
      };

      logger.info(`Sifely tokens extracted - access_token: ${tokens.access_token?.substring(0, 30) || 'MISSING'}`);
      this.storeTokens(tokens);

      logger.info("Sifely login successful");
      return tokens;
    } catch (error: any) {
      // Log detailed error info
      if (error.response) {
        logger.error(`Sifely login failed - Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`Sifely login failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshAccessToken(): Promise<SifelyTokenResponse> {
    if (!this.refreshToken) {
      // No refresh token, do a fresh login
      return await this.login();
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/system/smart/oauthToken`,
        null,
        {
          params: {
            client_id: this.clientId,
            grant_type: "refresh_token",
            refresh_token: this.refreshToken,
          },
        }
      );

      const tokens: SifelyTokenResponse = response.data;
      this.storeTokens(tokens);

      logger.info("Sifely token refreshed");
      return tokens;
    } catch (error: any) {
      logger.error("Sifely token refresh failed, attempting login:", error.message);
      // Refresh failed, try fresh login
      return await this.login();
    }
  }

  /**
   * Get a valid access token, auto-login if needed
   */
  async getValidAccessToken(): Promise<string> {
    // Check if token is expired or about to expire (5 min buffer)
    if (this.accessToken && this.tokenExpiry) {
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (new Date().getTime() < this.tokenExpiry.getTime() - bufferMs) {
        return this.accessToken;
      }
    }

    // Token expired or not set, try to refresh or login
    if (this.refreshToken) {
      const tokens = await this.refreshAccessToken();
      return tokens.access_token;
    }

    // No tokens at all, do initial login
    const tokens = await this.login();
    return tokens.access_token;
  }

  /**
   * Store tokens in memory
   */
  private storeTokens(tokens: SifelyTokenResponse): void {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);
  }

  /**
   * Check if the service has valid credentials configured
   */
  isConfigured(): boolean {
    return !!this.clientId && !!this.username && !!this.password;
  }

  /**
   * Get axios config with authorization header
   */
  async getAxiosConfig(): Promise<object> {
    const token = await this.getValidAccessToken();
    return {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
    };
  }
}

