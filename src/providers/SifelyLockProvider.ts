import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  ILockProvider,
  ConnectionOptions,
  ConnectionResult,
  Device,
  CreateAccessCodeParams,
  UpdateAccessCodeParams,
  ProviderAccessCode,
} from "../interfaces/ILockProvider";
import { SifelyAuthService } from "../services/SifelyAuthService";
import logger from "../utils/logger.utils";

const SIFELY_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sifely Lock Provider Implementation
 * Implements ILockProvider interface for Sifely API
 * All credentials are read from environment variables
 *
 * apiUrl is the smart-server (production API host) — all `/v3/*` operations
 * MUST target this. baseUrl is only used by the OAuth service for
 * `/system/smart/login`, which lives on a different origin on some tenants.
 * Historically createAccessCode targeted baseUrl (defaulting to dev-alexa),
 * which surfaced as 504 Gateway Timeout when the dev proxy couldn't reach the
 * upstream smart-server.
 */
export class SifelyLockProvider implements ILockProvider {
  readonly providerName = "sifely";
  private baseUrl: string;
  private apiUrl: string;
  private authService: SifelyAuthService;

  constructor() {
    this.baseUrl = process.env.SIFELY_BASE_URL || "https://dev-alexa.sifely.com";
    this.apiUrl = process.env.SIFELY_API_URL || "https://app-smart-server.sifely.com";
    this.authService = new SifelyAuthService();
  }

  /**
   * Retry a Sifely request once on 504 / connection timeouts. These are
   * transient — usually the lock's gateway is briefly unreachable and a
   * follow-up succeeds. Non-5xx failures aren't retried.
   */
  private async requestWithRetry<T = any>(config: AxiosRequestConfig, attempt = 1): Promise<AxiosResponse<T>> {
    try {
      return await axios.request<T>({ timeout: SIFELY_REQUEST_TIMEOUT_MS, ...config });
    } catch (error: any) {
      const status = error?.response?.status;
      const isTransient = status === 502 || status === 503 || status === 504 || error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT";
      if (!isTransient || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
      return this.requestWithRetry<T>(config, attempt + 1);
    }
  }

  /**
   * Rewrite raw axios errors into something an operator can act on.
   * "Request failed with status code 504" isn't helpful in a tooltip.
   */
  private normalizeSifelyError(error: any, action: string): Error {
    const status = error?.response?.status;
    const apiMessage = error?.response?.data?.message || error?.response?.data?.errmsg;
    if (status === 504 || error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
      return new Error(`Sifely did not respond in time while ${action}. The lock's gateway may be offline or unreachable — check the device's connection and retry.`);
    }
    if (status && status >= 500) {
      return new Error(`Sifely server error (${status}) while ${action}. Retry shortly; if it persists, the lock or gateway is likely offline.`);
    }
    if (apiMessage) return new Error(apiMessage);
    return new Error(error?.message || `Failed while ${action}`);
  }

  /**
   * Creates a connection URL for OAuth flow
   * For Sifely with env credentials, this just returns a status check URL
   */
  async createConnectionUrl(options: ConnectionOptions): Promise<ConnectionResult> {
    // With env-based credentials, connection is automatic
    // Return a simple status indicating env-based auth
    return {
      connectWebviewId: `sifely_env_${Date.now()}`,
      url: "", // No URL needed - credentials from env
      status: this.authService.isConfigured() ? "authorized" : "pending",
    };
  }

  /**
   * Gets the connection status
   * For Sifely, we verify by checking if credentials are configured and can authenticate
   */
  async getConnectionStatus(connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }> {
    try {
      if (!this.authService.isConfigured()) {
        return {
          status: "not_configured",
        };
      }
      await this.authService.getValidAccessToken();
      return {
        status: "authorized",
        connectedAccountId: connectWebviewId,
      };
    } catch {
      return {
        status: "failed",
      };
    }
  }

  /**
   * Lists all devices (locks) for the connected account
   * Uses the /v3/key/list endpoint to get eKeys
   */
  async listDevices(connectedAccountId?: string): Promise<Device[]> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      logger.info(`Sifely listDevices - using API URL: ${this.apiUrl}, token prefix: ${accessToken?.substring(0, 20)}...`);

      const response = await this.requestWithRetry({
        method: "post",
        url: `${this.apiUrl}/v3/key/list`,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        params: {
          pageNo: 1,
          pageSize: 100,
        },
      });

      const data = response.data;
      logger.info(`Sifely listDevices response code: ${data.code}, message: ${data.message}`);

      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || "Failed to fetch devices");
      }

      const locks = data.list || [];
      logger.info(`Sifely found ${locks.length} devices`);

      if (locks.length > 0) {
        logger.info(`Sifely first lock fields: ${JSON.stringify(Object.keys(locks[0]))}`);
        logger.info(`Sifely first lock data: ${JSON.stringify(locks[0])}`);
      }

      return locks.map((lock: any) => this.mapSifelyLockToDevice(lock));
    } catch (error: any) {
      logger.error("Error fetching Sifely devices:", error.response?.data || error.message);
      throw this.normalizeSifelyError(error, "fetching devices");
    }
  }

  /**
   * Gets a single device by its external ID (lockId)
   * Sifely's `/v3/lock/detail` is a POST endpoint per the API docs; using GET
   * yields a 405 or an empty response on some deployments.
   */
  async getDevice(externalDeviceId: string): Promise<Device> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      const response = await this.requestWithRetry({
        method: "post",
        url: `${this.apiUrl}/v3/lock/detail`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        params: { lockId: externalDeviceId },
      });

      const data = response.data;
      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || data.errmsg || "Failed to fetch device");
      }

      return this.mapSifelyLockToDevice(data.data || data);
    } catch (error: any) {
      const normalized = this.normalizeSifelyError(error, "fetching device");
      logger.error("Error fetching Sifely device:", normalized.message);
      throw normalized;
    }
  }

  /**
   * Creates an access code (passcode) on a device
   * Uses the Sifely API with Bearer token auth and query parameters
   * Docs: https://apidocs.sifely.com/api-197300856
   *
   * addType is the ADD METHOD (2 = remote add via gateway or Wi-Fi lock).
   * keyboardPwdType is the VALIDITY TYPE (2 = permanent, 3 = period).
   * These are distinct — see the Sifely docs; the earlier implementation
   * conflated them, which caused every period-limited create to fail.
   */
  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      const queryParams: any = {
        lockId: params.deviceId,
        keyboardPwd: params.code,
        keyboardPwdName: params.name || "Access Code",
        addType: 2, // Remote add (gateway / Wi-Fi lock)
      };

      // Validity type: 3 = time-limited (period), 2 = permanent
      if (params.startsAt && params.endsAt) {
        queryParams.keyboardPwdType = 3;
        const start = new Date(params.startsAt).getTime();
        const end = new Date(params.endsAt).getTime();
        // Sifely rejects a start time in the past on many gateway configs;
        // clamp to now + 60s so the passcode is programmable immediately.
        const now = Date.now();
        queryParams.startDate = Math.max(start, now + 60_000);
        queryParams.endDate = end;
      } else {
        queryParams.keyboardPwdType = 2;
      }

      logger.info(`Creating Sifely passcode for device ${params.deviceId} via ${this.apiUrl}/v3/keyboardPwd/add`);

      const response = await this.requestWithRetry({
        method: "post",
        url: `${this.apiUrl}/v3/keyboardPwd/add`,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        params: queryParams,
      });

      const data = response.data;
      logger.info(`Sifely createAccessCode response: ${JSON.stringify(data)}`);

      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || `Failed to create passcode with code: ${data.code}`);
      }

      logger.info(`Created Sifely passcode for device ${params.deviceId}, keyboardPwdId: ${data.keyboardPwdId}`);

      return {
        externalCodeId: data.keyboardPwdId?.toString() || `${params.deviceId}_${Date.now()}`,
        code: data.keyboardPwd || params.code,
        name: params.name,
        status: "set",
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        providerMetadata: data,
      };
    } catch (error: any) {
      const normalized = this.normalizeSifelyError(error, "creating passcode");
      logger.error("Error creating Sifely passcode:", normalized.message);
      throw normalized;
    }
  }

  /**
   * Updates an existing access code
   * Uses the Sifely API with Bearer token auth and query parameters
   * Docs: https://apidocs.sifely.com/api-197300857
   */
  async updateAccessCode(
    externalCodeId: string,
    params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      const queryParams: any = {
        keyboardPwdId: externalCodeId,
      };

      if (params.code) queryParams.keyboardPwd = params.code;
      if (params.name) queryParams.keyboardPwdName = params.name;
      if (params.startsAt) queryParams.startDate = new Date(params.startsAt).getTime();
      if (params.endsAt) queryParams.endDate = new Date(params.endsAt).getTime();

      const response = await this.requestWithRetry({
        method: "post",
        url: `${this.apiUrl}/v3/keyboardPwd/change`,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        params: queryParams,
      });

      const data = response.data;
      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || "Failed to update passcode");
      }

      logger.info(`Updated Sifely passcode ${externalCodeId}`);

      return {
        externalCodeId,
        code: params.code || "",
        name: params.name,
        status: "set",
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        providerMetadata: data,
      };
    } catch (error: any) {
      const normalized = this.normalizeSifelyError(error, "updating passcode");
      logger.error("Error updating Sifely passcode:", normalized.message);
      throw normalized;
    }
  }

  /**
   * Deletes an access code
   * Uses the Sifely API with Bearer token auth and query parameters
   * Docs: https://apidocs.sifely.com/api-197300858
   */
  async deleteAccessCode(externalCodeId: string): Promise<void> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      const queryParams = {
        keyboardPwdId: externalCodeId,
      };

      const response = await this.requestWithRetry({
        method: "post",
        url: `${this.apiUrl}/v3/keyboardPwd/delete`,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        params: queryParams,
      });

      const data = response.data;
      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || "Failed to delete passcode");
      }

      logger.info(`Deleted Sifely passcode ${externalCodeId}`);
    } catch (error: any) {
      const normalized = this.normalizeSifelyError(error, "deleting passcode");
      logger.error("Error deleting Sifely passcode:", normalized.message);
      throw normalized;
    }
  }

  /**
   * Lists all access codes for a device
   * Uses the Sifely API with Bearer token auth
   * Docs: https://apidocs.sifely.com/api-194455500
   */
  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    try {
      const accessToken = await this.authService.getValidAccessToken();

      const response = await this.requestWithRetry({
        method: "get",
        url: `${this.apiUrl}/v3/lock/listKeyboardPwd`,
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
        params: {
          lockId: externalDeviceId,
          pageNo: 1,
          pageSize: 100,
        },
      });

      const data = response.data;
      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || "Failed to fetch passcodes");
      }

      const passcodes = data.list || [];
      return passcodes.map((code: any) => this.mapSifelyPasscodeToProviderAccessCode(code));
    } catch (error: any) {
      const normalized = this.normalizeSifelyError(error, "fetching passcodes");
      logger.error("Error fetching Sifely passcodes:", normalized.message);
      throw normalized;
    }
  }

  /**
   * Maps Sifely lock response to our Device interface
   */
  private mapSifelyLockToDevice(sifelyLock: any): Device {
    return {
      externalDeviceId: sifelyLock.lockId?.toString(),
      provider: this.providerName,
      connectedAccountId: sifelyLock.groupId?.toString(),
      deviceName: sifelyLock.lockAlias || sifelyLock.lockName,
      deviceType: "smart_lock",
      manufacturer: "Sifely",
      model: sifelyLock.lockName,
      locationName: sifelyLock.groupName,
      isOnline: sifelyLock.keyStatus === "110401", // 110401 = normal
      capabilities: {
        lock: true,
        unlock: true,
        access_codes: true,
      },
      // Battery level (0-100 to 0-1 for interface compatibility)
      batteryLevel: sifelyLock.electricQuantity ? sifelyLock.electricQuantity / 100 : undefined,
      batteryStatus: this.getBatteryStatus(sifelyLock.electricQuantity),
      providerMetadata: {
        // Store electricQuantity directly for frontend access
        electricQuantity: sifelyLock.electricQuantity,
        lockMac: sifelyLock.lockMac,
        featureValue: sifelyLock.featureValue,
        keyRight: sifelyLock.keyRight,
        keyStatus: sifelyLock.keyStatus,
        passageMode: sifelyLock.passageMode,
        remoteEnable: sifelyLock.remoteEnable,
        noKeyPwd: sifelyLock.noKeyPwd,
        remarks: sifelyLock.remarks,
        startDate: sifelyLock.startDate,
        endDate: sifelyLock.endDate,
        userType: sifelyLock.userType,
        hasGateway: sifelyLock.hasGateway,
      },
    };
  }

  /**
   * Maps Sifely passcode response to our ProviderAccessCode interface
   */
  private mapSifelyPasscodeToProviderAccessCode(sifelyCode: any): ProviderAccessCode {
    return {
      externalCodeId: sifelyCode.keyboardPwdId?.toString(),
      code: sifelyCode.keyboardPwd,
      name: sifelyCode.keyboardPwdName,
      status: this.mapPasscodeStatus(sifelyCode.keyboardPwdType, sifelyCode.sendDate, sifelyCode.endDate),
      startsAt: sifelyCode.startDate ? new Date(sifelyCode.startDate).toISOString() : undefined,
      endsAt: sifelyCode.endDate ? new Date(sifelyCode.endDate).toISOString() : undefined,
      providerMetadata: {
        keyboardPwdType: sifelyCode.keyboardPwdType,
        sendDate: sifelyCode.sendDate,
        senderUsername: sifelyCode.senderUsername,
      },
    };
  }

  /**
   * Get battery status from percentage
   */
  private getBatteryStatus(electricQuantity: number | undefined): string | undefined {
    if (electricQuantity === undefined) return undefined;
    if (electricQuantity <= 10) return "critical";
    if (electricQuantity <= 25) return "low";
    if (electricQuantity <= 75) return "good";
    return "full";
  }

  /**
   * Map Sifely passcode row to our status field.
   * Sifely `keyboardPwdType` values (per docs):
   *   1 = one-time, 2 = permanent, 3 = period, 4 = cyclic, 5 = customized,
   *   6 = customized cyclic, 7 = office pass.
   * A missing `sendDate` means the passcode hasn't been synced to the lock yet.
   * A period passcode whose `endDate` is in the past is considered expired.
   */
  private mapPasscodeStatus(
    type: number | undefined,
    sendDate: number | undefined,
    endDate?: number,
  ): string {
    if (!sendDate) return "pending";
    if (type === 3 && endDate && endDate < Date.now()) return "removed";
    return "set";
  }
}
