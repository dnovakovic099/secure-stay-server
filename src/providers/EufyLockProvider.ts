import type { Device, Schedule } from "eufy-security-client";
import {
  ILockProvider,
  ConnectionOptions,
  ConnectionResult,
  Device as ProviderDevice,
  CreateAccessCodeParams,
  UpdateAccessCodeParams,
  ProviderAccessCode,
} from "../interfaces/ILockProvider";
import { EufyClientService, loadEufyAccounts } from "../services/EufyClientService";
import logger from "../utils/logger.utils";

/**
 * Eufy Security smart locks via the reverse-engineered consumer cloud.
 *
 * Uses the same path bropat/eufy-security-client (the library HA's
 * eufy_security integration is built on) rather than Anker's partner
 * program. Passcode CRUD is exposed as user records keyed by *username*
 * — Eufy has no separate stable id, so a rename changes what we treat as
 * the external code id. The service layer captures the returned
 * `ProviderAccessCode.externalCodeId` after each update to keep the DB in sync.
 *
 * Device ids are namespaced `{accountLabel}:{deviceSN}` so multiple Eufy
 * accounts don't collide, matching the Schlage convention.
 */
export class EufyLockProvider implements ILockProvider {
  readonly providerName = "eufy";
  private client = EufyClientService.getInstance();

  private parseExternalDeviceId(externalDeviceId: string): { label: string; deviceSN: string } {
    const separator = externalDeviceId.indexOf(":");
    if (separator <= 0) {
      throw new Error(
        `Invalid Eufy device id "${externalDeviceId}". Expected "account:deviceSN".`,
      );
    }
    return {
      label: externalDeviceId.slice(0, separator),
      deviceSN: externalDeviceId.slice(separator + 1),
    };
  }

  private parseExternalCodeId(externalCodeId: string): {
    label: string;
    deviceSN: string;
    username: string;
  } {
    const parts = externalCodeId.split(":");
    if (parts.length < 3) {
      throw new Error(
        `Invalid Eufy code id "${externalCodeId}". Expected "account:deviceSN:username".`,
      );
    }
    const [label, deviceSN, ...rest] = parts;
    // Usernames can contain ':' in theory (unlikely, but defend against it).
    return { label, deviceSN, username: rest.join(":") };
  }

  async createConnectionUrl(_options: ConnectionOptions): Promise<ConnectionResult> {
    // Eufy uses direct email/password credentials configured via env — no
    // OAuth flow. Match the Schlage provider's response shape so the shared
    // caller code doesn't need to special-case us.
    const accounts = loadEufyAccounts();
    return {
      connectWebviewId: `eufy_env_${Date.now()}`,
      url: "",
      status: accounts.length ? "authorized" : "pending",
    };
  }

  async getConnectionStatus(_connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }> {
    const accounts = loadEufyAccounts();
    if (!accounts.length) return { status: "not_configured" };

    // Probing every configured account on a status check is expensive
    // (each triggers a full login). Report the first successful account
    // and leave the rest to be attempted lazily by real device calls.
    for (const account of accounts) {
      try {
        await this.client.getClient(account.label);
        return { status: "authorized", connectedAccountId: account.label };
      } catch (error: any) {
        logger.warn(`[Eufy] connection check failed for ${account.label}: ${error.message}`);
      }
    }
    return { status: "failed" };
  }

  async listDevices(_connectedAccountId?: string): Promise<ProviderDevice[]> {
    const accounts = loadEufyAccounts();
    if (!accounts.length) {
      throw new Error(
        "Eufy credentials not configured. Set EUFY_ACCOUNTS_JSON (or EUFY_EMAIL/EUFY_PASSWORD).",
      );
    }

    const devices: ProviderDevice[] = [];
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const raw = await this.client.listDevices(account.label);
        for (const dev of raw) {
          // The Eufy account may hold cameras, doorbells, and locks. Only
          // smart locks belong here; everything else is skipped so the
          // dashboard doesn't list irrelevant devices.
          if (!this.isLockDevice(dev)) continue;
          devices.push(this.mapDevice(account.label, dev));
        }
      } catch (error: any) {
        errors.push(`${account.label}: ${error.message}`);
        logger.error(`[Eufy] listDevices failed for ${account.label}: ${error.message}`);
      }
    }

    if (!devices.length && errors.length) {
      throw new Error(`Eufy sync failed: ${errors.join("; ")}`);
    }
    return devices;
  }

  async getDevice(externalDeviceId: string): Promise<ProviderDevice> {
    const { label, deviceSN } = this.parseExternalDeviceId(externalDeviceId);
    const dev = await this.client.getDevice(label, deviceSN);
    return this.mapDevice(label, dev);
  }

  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    const { label, deviceSN } = this.parseExternalDeviceId(params.deviceId);
    const device = await this.client.getDevice(label, deviceSN);
    const schedule = this.buildSchedule(params.startsAt, params.endsAt);

    // Eufy uses `username` as the primary key on the lock — the same string
    // shows up in the Eufy app's user list, doubles as our name-column display
    // value, and is the handle we pass back on updates. This is why our
    // external code id embeds the username rather than an opaque id.
    await (device as any).addUser(params.name, params.code, schedule);

    return {
      externalCodeId: `${label}:${deviceSN}:${params.name}`,
      code: params.code,
      name: params.name,
      status: "set",
      startsAt: params.startsAt,
      endsAt: params.endsAt,
    };
  }

  async updateAccessCode(
    externalCodeId: string,
    params: UpdateAccessCodeParams,
  ): Promise<ProviderAccessCode> {
    const { label, deviceSN, username } = this.parseExternalCodeId(externalCodeId);
    const device = await this.client.getDevice(label, deviceSN);

    let currentUsername = username;

    // Order matters: rename first, then use the new username for subsequent
    // updates. If we renamed *after* changing the passcode/schedule, we'd
    // have to pass the old name to those calls, which is confusing to trace
    // in logs when things go wrong.
    if (params.name && params.name !== username) {
      await (device as any).updateUser(currentUsername, params.name);
      currentUsername = params.name;
    }

    if (params.code) {
      await (device as any).updateUserPasscode(currentUsername, params.code);
    }

    if (params.startsAt || params.endsAt) {
      const schedule = this.buildSchedule(params.startsAt, params.endsAt);
      if (schedule) {
        await (device as any).updateUserSchedule(currentUsername, schedule);
      }
    }

    return {
      externalCodeId: `${label}:${deviceSN}:${currentUsername}`,
      code: params.code || "",
      name: currentUsername,
      status: "set",
      startsAt: params.startsAt,
      endsAt: params.endsAt,
    };
  }

  async deleteAccessCode(externalCodeId: string, _externalDeviceId?: string): Promise<void> {
    const { label, deviceSN, username } = this.parseExternalCodeId(externalCodeId);
    const device = await this.client.getDevice(label, deviceSN);
    await (device as any).deleteUser(username);
  }

  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    const { label, deviceSN } = this.parseExternalDeviceId(externalDeviceId);
    const device = await this.client.getDevice(label, deviceSN);
    const users: any[] = (await (device as any).getUsers()) || [];

    return users.map((user) => {
      const username = user.username ?? user.name ?? "";
      const schedule = user.schedule || {};
      return {
        externalCodeId: `${label}:${deviceSN}:${username}`,
        code: user.passcode || user.password || "",
        name: username,
        status: "set",
        startsAt: schedule.startDateTime ? new Date(schedule.startDateTime).toISOString() : undefined,
        endsAt: schedule.endDateTime ? new Date(schedule.endDateTime).toISOString() : undefined,
        providerMetadata: { raw: user },
      };
    });
  }

  private buildSchedule(startsAt?: string, endsAt?: string): Schedule | undefined {
    if (!startsAt && !endsAt) return undefined;

    // Passcodes without a schedule are permanent on the Eufy side. Every
    // day-of-week is enabled so the code works throughout the stay window;
    // omit `week` entirely and Eufy defaults to no-days-enabled, which
    // silently locks the guest out.
    return {
      startDateTime: startsAt ? new Date(startsAt) : undefined,
      endDateTime: endsAt ? new Date(endsAt) : undefined,
      week: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true,
      },
    };
  }

  private isLockDevice(device: Device): boolean {
    // The library exposes helpers like isLock() / isSmartLock() on the
    // Device instance; call whichever is present. We fall back to inspecting
    // the raw device_type string so future library versions don't silently
    // drop every Eufy lock from the fleet.
    const anyDev = device as any;
    if (typeof anyDev.isLock === "function" && anyDev.isLock()) return true;
    if (typeof anyDev.isSmartLock === "function" && anyDev.isSmartLock()) return true;
    const type = String(anyDev.getDeviceType?.() ?? "").toLowerCase();
    return type.includes("lock");
  }

  private mapDevice(label: string, dev: Device): ProviderDevice {
    const anyDev = dev as any;
    const deviceSN = String(anyDev.getSerial?.() ?? anyDev.serial ?? "");
    const externalDeviceId = `${label}:${deviceSN}`;
    return {
      externalDeviceId,
      provider: this.providerName,
      connectedAccountId: label,
      deviceName: anyDev.getName?.() || anyDev.getModel?.() || `Eufy Lock ${deviceSN}`,
      deviceType: "smart_lock",
      manufacturer: "Eufy",
      model: anyDev.getModel?.() || undefined,
      isOnline: typeof anyDev.isConnected === "function" ? anyDev.isConnected() : undefined,
      isLocked:
        typeof anyDev.getLockStatus === "function"
          ? Boolean(anyDev.getLockStatus())
          : undefined,
      batteryLevel:
        typeof anyDev.getBatteryValue === "function"
          ? anyDev.getBatteryValue() / 100
          : undefined,
      capabilities: { lock: true, unlock: true, access_codes: true },
      providerMetadata: {
        accountLabel: label,
        rawDeviceSN: deviceSN,
      },
    };
  }
}
