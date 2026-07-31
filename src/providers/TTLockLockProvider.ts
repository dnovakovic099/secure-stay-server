import axios from "axios";
import crypto from "crypto";
import {
  ILockProvider,
  ConnectionOptions,
  ConnectionResult,
  Device,
  CreateAccessCodeParams,
  UpdateAccessCodeParams,
  ProviderAccessCode,
} from "../interfaces/ILockProvider";
import logger from "../utils/logger.utils";

interface TTLockAccount {
  label: string;
  username: string;
  password: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * TTLock / Sciener Open Platform.
 *
 * DD Lock and TT Lock consumer portals are skins on this same backend — proven
 * by their JS bundles calling Sciener. One Sciener developer app + each
 * account's username/password covers both brands without scraping.
 */
export class TTLockLockProvider implements ILockProvider {
  readonly providerName = "ttlock";
  private clientId = process.env.SCIENER_CLIENT_ID || "";
  private clientSecret = process.env.SCIENER_CLIENT_SECRET || "";
  private apiBase = "https://euapi.ttlock.com";
  private tokens = new Map<string, TokenCache>();

  private accounts(): TTLockAccount[] {
    const raw = process.env.TTLOCK_ACCOUNTS_JSON?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((row: any, index: number) => ({
            label: String(row.label || row.username || `account-${index + 1}`),
            username: String(row.username || "").trim(),
            password: String(row.password || ""),
          }))
          .filter((row) => row.username && row.password);
      } catch (error: any) {
        logger.error(`[TTLock] Failed to parse TTLOCK_ACCOUNTS_JSON: ${error.message}`);
        return [];
      }
    }

    const accounts: TTLockAccount[] = [];
    if (process.env.TTLOCK_USERNAME && process.env.TTLOCK_PASSWORD) {
      accounts.push({
        label: "ttlock",
        username: process.env.TTLOCK_USERNAME,
        password: process.env.TTLOCK_PASSWORD,
      });
    }
    if (process.env.DDLOCK_USERNAME && process.env.DDLOCK_PASSWORD) {
      accounts.push({
        label: "ddlock",
        username: process.env.DDLOCK_USERNAME,
        password: process.env.DDLOCK_PASSWORD,
      });
    }
    return accounts;
  }

  private parseExternalId(externalDeviceId: string): {
    account: TTLockAccount;
    lockId: string;
  } {
    const separator = externalDeviceId.indexOf(":");
    if (separator <= 0) {
      throw new Error(
        `Invalid TTLock device id "${externalDeviceId}". Expected "account:lockId".`
      );
    }
    const label = externalDeviceId.slice(0, separator);
    const lockId = externalDeviceId.slice(separator + 1);
    const account = this.accounts().find((row) => row.label === label);
    if (!account) {
      throw new Error(`No TTLock credentials configured for account "${label}"`);
    }
    return { account, lockId };
  }

  private hashPassword(password: string): string {
    return crypto.createHash("md5").update(password, "utf-8").digest("hex");
  }

  private async getAccessToken(account: TTLockAccount): Promise<string> {
    const cached = this.tokens.get(account.label);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "SCIENER_CLIENT_ID and SCIENER_CLIENT_SECRET are required for TTLock/DD Lock"
      );
    }

    const response = await axios.post(
      `${this.apiBase}/oauth2/token`,
      new URLSearchParams({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        username: account.username,
        password: this.hashPassword(account.password),
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 }
    );

    const data = response.data;
    if (!data?.access_token) {
      throw new Error(
        data?.errmsg || data?.message || `TTLock login failed for ${account.label}`
      );
    }

    this.tokens.set(account.label, {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
    });
    return data.access_token;
  }

  async createConnectionUrl(_options: ConnectionOptions): Promise<ConnectionResult> {
    const ready = this.accounts().length > 0 && !!this.clientId && !!this.clientSecret;
    return {
      connectWebviewId: `ttlock_env_${Date.now()}`,
      url: "",
      status: ready ? "authorized" : "pending",
    };
  }

  async getConnectionStatus(_connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }> {
    const accounts = this.accounts();
    if (!accounts.length || !this.clientId || !this.clientSecret) {
      return { status: "not_configured" };
    }
    try {
      await this.getAccessToken(accounts[0]);
      return { status: "authorized", connectedAccountId: accounts[0].label };
    } catch {
      return { status: "failed" };
    }
  }

  async listDevices(_connectedAccountId?: string): Promise<Device[]> {
    const accounts = this.accounts();
    if (!accounts.length) {
      throw new Error(
        "TTLock credentials not configured. Set TTLOCK_ACCOUNTS_JSON or TTLOCK_USERNAME/DDLOCK_USERNAME pairs."
      );
    }

    const devices: Device[] = [];
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const accessToken = await this.getAccessToken(account);
        let pageNo = 1;
        const pageSize = 100;
        while (true) {
          const response = await axios.get(`${this.apiBase}/v3/lock/list`, {
            params: {
              clientId: this.clientId,
              accessToken,
              pageNo,
              pageSize,
              date: Date.now(),
            },
            timeout: 30_000,
          });
          const list = response.data?.list || [];
          for (const lock of list) {
            const electric = lock.electricQuantity;
            devices.push({
              externalDeviceId: `${account.label}:${lock.lockId}`,
              provider: this.providerName,
              connectedAccountId: account.label,
              deviceName: lock.lockAlias || lock.lockName,
              deviceType: "smart_lock",
              manufacturer: account.label === "ddlock" ? "DD Lock" : "TTLock",
              model: lock.lockName,
              isOnline: lock.hasGateway === 1 || lock.lockData != null,
              batteryLevel:
                electric === undefined || electric === null ? undefined : electric / 100,
              batteryStatus:
                electric == null
                  ? undefined
                  : electric <= 10
                    ? "critical"
                    : electric <= 25
                      ? "low"
                      : electric <= 75
                        ? "good"
                        : "full",
              capabilities: { lock: true, unlock: true, access_codes: true },
              providerMetadata: {
                accountLabel: account.label,
                lockMac: lock.lockMac,
                hasGateway: lock.hasGateway,
                remoteEnable: lock.remoteEnable,
                electricQuantity: electric,
              },
            });
          }
          if (list.length < pageSize) break;
          pageNo += 1;
          if (pageNo > 20) break;
        }
      } catch (error: any) {
        errors.push(`${account.label}: ${error?.response?.data?.errmsg || error.message}`);
        logger.error(`[TTLock] listDevices failed for ${account.label}:`, error.message);
      }
    }

    if (!devices.length && errors.length) {
      throw new Error(`TTLock sync failed: ${errors.join("; ")}`);
    }
    return devices;
  }

  async getDevice(externalDeviceId: string): Promise<Device> {
    const devices = await this.listDevices();
    const device = devices.find((row) => row.externalDeviceId === externalDeviceId);
    if (!device) throw new Error(`TTLock device not found: ${externalDeviceId}`);
    return device;
  }

  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    const { account, lockId } = this.parseExternalId(params.deviceId);
    const accessToken = await this.getAccessToken(account);

    const body: Record<string, string | number> = {
      clientId: this.clientId,
      accessToken,
      lockId: Number(lockId),
      keyboardPwd: params.code,
      keyboardPwdName: params.name || "Access Code",
      addType: 2,
      date: Date.now(),
    };

    if (params.startsAt && params.endsAt) {
      body.keyboardPwdType = 3;
      const start = new Date(params.startsAt).getTime();
      const end = new Date(params.endsAt).getTime();
      body.startDate = Math.max(start, Date.now() + 60_000);
      body.endDate = end;
    } else {
      body.keyboardPwdType = 2;
    }

    const response = await axios.post(
      `${this.apiBase}/v3/keyboardPwd/add`,
      new URLSearchParams(
        Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))
      ),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 }
    );

    const data = response.data;
    if (data.errcode && data.errcode !== 0) {
      throw new Error(data.errmsg || `TTLock create failed (${data.errcode})`);
    }

    return {
      externalCodeId: `${account.label}:${lockId}:${data.keyboardPwdId}`,
      code: params.code,
      name: params.name,
      status: "set",
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      providerMetadata: data,
    };
  }

  async updateAccessCode(
    _externalCodeId: string,
    _params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode> {
    throw new Error("TTLock access-code updates are not supported. Delete and recreate.");
  }

  async deleteAccessCode(externalCodeId: string): Promise<void> {
    const parts = externalCodeId.split(":");
    if (parts.length < 3) throw new Error(`Invalid TTLock code id "${externalCodeId}"`);
    const [label, lockId, keyboardPwdId] = parts;
    const account = this.accounts().find((row) => row.label === label);
    if (!account) throw new Error(`No TTLock credentials for account "${label}"`);
    const accessToken = await this.getAccessToken(account);

    const response = await axios.post(
      `${this.apiBase}/v3/keyboardPwd/delete`,
      new URLSearchParams({
        clientId: this.clientId,
        accessToken,
        lockId,
        keyboardPwdId,
        deleteType: "2",
        date: String(Date.now()),
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 }
    );

    if (response.data?.errcode && response.data.errcode !== 0) {
      throw new Error(response.data.errmsg || "TTLock delete failed");
    }
  }

  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    const { account, lockId } = this.parseExternalId(externalDeviceId);
    const accessToken = await this.getAccessToken(account);
    const response = await axios.get(`${this.apiBase}/v3/lock/listKeyboardPwd`, {
      params: {
        clientId: this.clientId,
        accessToken,
        lockId,
        pageNo: 1,
        pageSize: 100,
        date: Date.now(),
      },
      timeout: 30_000,
    });

    return (response.data?.list || []).map((code: any) => ({
      externalCodeId: `${account.label}:${lockId}:${code.keyboardPwdId}`,
      code: String(code.keyboardPwd ?? ""),
      name: code.keyboardPwdName,
      status: "set",
      startsAt: code.startDate ? new Date(code.startDate).toISOString() : undefined,
      endsAt: code.endDate ? new Date(code.endDate).toISOString() : undefined,
    }));
  }
}
