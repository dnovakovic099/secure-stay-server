import {
  ILockProvider,
  ConnectionOptions,
  ConnectionResult,
  Device,
  CreateAccessCodeParams,
  UpdateAccessCodeParams,
  ProviderAccessCode,
} from "../interfaces/ILockProvider";
import {
  loadSchlageAccounts,
  SchlageAccount,
  SchlageBridgeService,
} from "../services/SchlageBridgeService";
import logger from "../utils/logger.utils";

/**
 * Schlage Encode / Encode Plus via Allegion's consumer cloud.
 *
 * This is the same path pyschlage uses — not Allegion's commercial partner API.
 * Allegion can change or revoke it; until the partner application is approved
 * this is the only free way to program the 37 Encode locks in the fleet.
 *
 * Multiple Schlage accounts are supported (main LL + client-owned accounts).
 * Devices are namespaced as `{accountLabel}:{deviceId}` so two accounts can
 * never collide in our DB even if Allegion ever reused an id.
 */
export class SchlageLockProvider implements ILockProvider {
  readonly providerName = "schlage";
  private bridge = new SchlageBridgeService();

  private accounts(): SchlageAccount[] {
    return loadSchlageAccounts();
  }

  private parseExternalId(externalDeviceId: string): {
    account: SchlageAccount;
    deviceId: string;
  } {
    const separator = externalDeviceId.indexOf(":");
    if (separator <= 0) {
      throw new Error(
        `Invalid Schlage device id "${externalDeviceId}". Expected "account:deviceId".`
      );
    }
    const label = externalDeviceId.slice(0, separator);
    const deviceId = externalDeviceId.slice(separator + 1);
    const account = this.accounts().find((row) => row.label === label);
    if (!account) {
      throw new Error(`No Schlage credentials configured for account "${label}"`);
    }
    return { account, deviceId };
  }

  async createConnectionUrl(_options: ConnectionOptions): Promise<ConnectionResult> {
    const accounts = this.accounts();
    return {
      connectWebviewId: `schlage_env_${Date.now()}`,
      url: "",
      status: accounts.length ? "authorized" : "pending",
    };
  }

  async getConnectionStatus(_connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }> {
    const accounts = this.accounts();
    if (!accounts.length) return { status: "not_configured" };

    try {
      await this.bridge.run(accounts[0], "ping");
      return { status: "authorized", connectedAccountId: accounts[0].label };
    } catch (error: any) {
      logger.error(`[Schlage] connection check failed: ${error.message}`);
      return { status: "failed" };
    }
  }

  async listDevices(_connectedAccountId?: string): Promise<Device[]> {
    const accounts = this.accounts();
    if (!accounts.length) {
      throw new Error(
        "Schlage credentials not configured. Set SCHLAGE_ACCOUNTS_JSON (or SCHLAGE_EMAIL/SCHLAGE_PASSWORD)."
      );
    }

    const devices: Device[] = [];
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const locks = await this.bridge.run<
          Array<{
            externalDeviceId: string;
            deviceName: string;
            deviceType: string;
            model: string;
            isOnline: boolean;
            isLocked: boolean | null;
            batteryLevel: number | null;
            batteryStatus: string | null;
          }>
        >(account, "list_devices");

        for (const lock of locks) {
          devices.push({
            externalDeviceId: `${account.label}:${lock.externalDeviceId}`,
            provider: this.providerName,
            connectedAccountId: account.label,
            deviceName: lock.deviceName,
            deviceType: lock.deviceType || "smart_lock",
            manufacturer: "Schlage",
            model: lock.model,
            isOnline: lock.isOnline,
            isLocked: lock.isLocked ?? undefined,
            batteryLevel: lock.batteryLevel ?? undefined,
            batteryStatus: lock.batteryStatus ?? undefined,
            capabilities: { lock: true, unlock: true, access_codes: true },
            providerMetadata: {
              accountLabel: account.label,
              accountEmail: account.email,
              rawDeviceId: lock.externalDeviceId,
            },
          });
        }
      } catch (error: any) {
        errors.push(`${account.label}: ${error.message}`);
        logger.error(`[Schlage] listDevices failed for ${account.label}: ${error.message}`);
      }
    }

    if (!devices.length && errors.length) {
      throw new Error(`Schlage sync failed: ${errors.join("; ")}`);
    }
    return devices;
  }

  async getDevice(externalDeviceId: string): Promise<Device> {
    const { account } = this.parseExternalId(externalDeviceId);
    const devices = await this.listDevices(account.label);
    const device = devices.find((row) => row.externalDeviceId === externalDeviceId);
    if (!device) throw new Error(`Schlage device not found: ${externalDeviceId}`);
    return device;
  }

  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    const { account, deviceId } = this.parseExternalId(params.deviceId);
    const result = await this.bridge.run<{
      externalCodeId: string;
      code: string;
      name: string;
      status: string;
      startsAt?: string;
      endsAt?: string;
    }>(account, "create_code", {
      deviceId,
      code: params.code,
      name: params.name,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
    });

    return {
      externalCodeId: `${account.label}:${deviceId}:${result.externalCodeId}`,
      code: result.code,
      name: result.name,
      status: result.status || "set",
      startsAt: result.startsAt,
      endsAt: result.endsAt,
    };
  }

  async updateAccessCode(
    externalCodeId: string,
    _params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode> {
    throw new Error(
      "Schlage access-code updates are not supported via this bridge. Delete and recreate the code instead."
    );
  }

  async deleteAccessCode(externalCodeId: string): Promise<void> {
    // externalCodeId format: account:deviceId:accessCodeId
    const parts = externalCodeId.split(":");
    if (parts.length < 3) {
      throw new Error(`Invalid Schlage code id "${externalCodeId}"`);
    }
    const [label, deviceId, ...rest] = parts;
    const accessCodeId = rest.join(":");
    const account = this.accounts().find((row) => row.label === label);
    if (!account) throw new Error(`No Schlage credentials for account "${label}"`);

    await this.bridge.run(account, "delete_code", {
      deviceId,
      externalCodeId: accessCodeId,
    });
  }

  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    const { account, deviceId } = this.parseExternalId(externalDeviceId);
    const codes = await this.bridge.run<
      Array<{
        externalCodeId: string;
        code: string;
        name: string;
        status: string;
        startsAt?: string;
        endsAt?: string;
      }>
    >(account, "list_codes", { deviceId });

    return codes.map((code) => ({
      externalCodeId: `${account.label}:${deviceId}:${code.externalCodeId}`,
      code: code.code,
      name: code.name,
      status: code.status,
      startsAt: code.startsAt,
      endsAt: code.endsAt,
    }));
  }
}
