import axios from "axios";
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

/**
 * Sifely Lock Provider Implementation
 * Implements ILockProvider interface for Sifely API
 * All credentials are read from environment variables
 */
export class SifelyLockProvider implements ILockProvider {
  readonly providerName = "sifely";
  private baseUrl: string;
  private authService: SifelyAuthService;

  constructor() {
    this.baseUrl = process.env.SIFELY_BASE_URL || "https://dev-alexa.sifely.com";
    this.authService = new SifelyAuthService();
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

      // Use the API server URL (different from auth server)
      const apiBaseUrl = process.env.SIFELY_API_URL || "https://app-smart-server.sifely.com";

      logger.info(`Sifely listDevices - using API URL: ${apiBaseUrl}, token prefix: ${accessToken?.substring(0, 20)}...`);

      // POST request with Bearer token in Authorization header and params in query string
      const response = await axios.post(
        `${apiBaseUrl}/v3/key/list`,
        null,
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          params: {
            pageNo: 1,
            pageSize: 100,
          },
        }
      );

      const data = response.data;
      logger.info(`Sifely listDevices response code: ${data.code}, message: ${data.message}`);

      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || "Failed to fetch devices");
      }

      const locks = data.list || [];
      logger.info(`Sifely found ${locks.length} devices`);

      // Log first lock to see available fields
      if (locks.length > 0) {
        logger.info(`Sifely first lock fields: ${JSON.stringify(Object.keys(locks[0]))}`);
        logger.info(`Sifely first lock data: ${JSON.stringify(locks[0])}`);
      }

      return locks.map((lock: any) => this.mapSifelyLockToDevice(lock));
    } catch (error: any) {
      logger.error("Error fetching Sifely devices:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Gets a single device by its external ID (lockId)
   */
  async getDevice(externalDeviceId: string): Promise<Device> {
    try {
      const config = await this.authService.getAxiosConfig();

      const response = await axios.get(
        `${this.baseUrl}/v3/lock/detail`,
        {
          ...config,
          params: {
            lockId: externalDeviceId,
          },
        }
      );

      const data = response.data;
      if (data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || "Failed to fetch device");
      }

      return this.mapSifelyLockToDevice(data.data || data);
    } catch (error: any) {
      logger.error("Error fetching Sifely device:", error.message);
      throw error;
    }
  }

  /**
   * Creates an access code (passcode) on a device
   */
  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    try {
      const config = await this.authService.getAxiosConfig();

      const body: any = {
        lockId: params.deviceId,
        keyboardPwd: params.code,
        keyboardPwdName: params.name,
        keyboardPwdType: 2, // 2 = permanent, 3 = period
      };

      // If time range is specified, use period type
      if (params.startsAt && params.endsAt) {
        body.keyboardPwdType = 3;
        body.startDate = new Date(params.startsAt).getTime();
        body.endDate = new Date(params.endsAt).getTime();
      }

      const response = await axios.post(
        `${this.baseUrl}/v3/keyboardPwd/add`,
        body,
        config
      );

      const data = response.data;
      if (data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || "Failed to create passcode");
      }

      logger.info(`Created Sifely passcode for device ${params.deviceId}`);

      return {
        externalCodeId: data.keyboardPwdId?.toString() || `${params.deviceId}_${Date.now()}`,
        code: params.code,
        name: params.name,
        status: "set",
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        providerMetadata: data,
      };
    } catch (error: any) {
      logger.error("Error creating Sifely passcode:", error.message);
      throw error;
    }
  }

  /**
   * Updates an existing access code
   */
  async updateAccessCode(
    externalCodeId: string,
    params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode> {
    try {
      const config = await this.authService.getAxiosConfig();

      const body: any = {
        keyboardPwdId: externalCodeId,
      };

      if (params.code) body.keyboardPwd = params.code;
      if (params.name) body.keyboardPwdName = params.name;
      if (params.startsAt) body.startDate = new Date(params.startsAt).getTime();
      if (params.endsAt) body.endDate = new Date(params.endsAt).getTime();

      const response = await axios.post(
        `${this.baseUrl}/v3/keyboardPwd/change`,
        body,
        config
      );

      const data = response.data;
      if (data.code !== undefined && data.code !== 0) {
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
      logger.error("Error updating Sifely passcode:", error.message);
      throw error;
    }
  }

  /**
   * Deletes an access code
   */
  async deleteAccessCode(externalCodeId: string): Promise<void> {
    try {
      const config = await this.authService.getAxiosConfig();

      const response = await axios.post(
        `${this.baseUrl}/v3/keyboardPwd/delete`,
        { keyboardPwdId: externalCodeId },
        config
      );

      const data = response.data;
      if (data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || "Failed to delete passcode");
      }

      logger.info(`Deleted Sifely passcode ${externalCodeId}`);
    } catch (error: any) {
      logger.error("Error deleting Sifely passcode:", error.message);
      throw error;
    }
  }

  /**
   * Lists all access codes for a device
   */
  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    try {
      const config = await this.authService.getAxiosConfig();

      const response = await axios.get(
        `${this.baseUrl}/v3/lock/listKeyboardPwd`,
        {
          ...config,
          params: {
            lockId: externalDeviceId,
            pageNo: 1,
            pageSize: 100,
          },
        }
      );

      const data = response.data;
      if (data.code !== undefined && data.code !== 0) {
        throw new Error(data.message || "Failed to fetch passcodes");
      }

      const passcodes = data.list || [];
      return passcodes.map((code: any) => this.mapSifelyPasscodeToProviderAccessCode(code));
    } catch (error: any) {
      logger.error("Error fetching Sifely passcodes:", error.message);
      throw error;
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
      status: this.mapPasscodeStatus(sifelyCode.keyboardPwdType, sifelyCode.sendDate),
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
   * Map Sifely passcode type to our status
   */
  private mapPasscodeStatus(type: number, sendDate: number | undefined): string {
    // Types: 1=once, 2=permanent, 3=period, 4=cycling, etc.
    if (!sendDate) return "pending";
    return "set";
  }
}
