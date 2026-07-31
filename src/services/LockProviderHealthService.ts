import { appDatabase } from "../utils/database.util";
import {
  LockProviderStatus,
  LockProviderHealth,
} from "../entity/LockProviderStatus";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import logger from "../utils/logger.utils";

/**
 * Env vars each provider needs before it can do anything. Used to distinguish
 * "never set up" from "set up but broken" — an operator needs a different
 * action for each, and a generic red dot for both is useless.
 */
const REQUIRED_ENV: Record<string, string[]> = {
  seam: ["SEAM_API_KEY"],
  // SIFELY_CLIENT_ID may also be supplied as SCIENER_CLIENT_ID — see isConfigured().
  // API key alone is enough; username/password used to mint one if missing.
  sifely: [],
  ttlock: ["SCIENER_CLIENT_ID", "SCIENER_CLIENT_SECRET"],
  schlage: [],
};

/** A probe slower than this still counts as reachable, but flags as degraded. */
const SLOW_PROBE_MS = 8_000;

export interface ProviderHealthResult {
  provider: string;
  status: LockProviderHealth;
  isConfigured: boolean;
  latencyMs: number | null;
  deviceCount: number | null;
  error: string | null;
}

/**
 * Tracks whether each lock integration is actually working.
 *
 * The existing code could only tell you a provider was *configured*; the daily
 * code push was the first thing to discover a broken credential, by which point
 * a guest was already at the door. This probes independently and persists the
 * result so the Locks page can show it.
 */
export class LockProviderHealthService {
  private statusRepository = appDatabase.getRepository(LockProviderStatus);

  private missingEnv(provider: string): string[] {
    const required = REQUIRED_ENV[provider] || [];
    const missing = required.filter((key) => !process.env[key]);

    if (provider === "sifely") {
      const hasKey = !!process.env.SIFELY_API_KEY;
      const hasLogin = !!(
        process.env.SIFELY_USERNAME && process.env.SIFELY_PASSWORD
      );
      if (!hasKey && !hasLogin) {
        missing.push("SIFELY_API_KEY|SIFELY_USERNAME+SIFELY_PASSWORD");
      }
    }

    if (provider === "ttlock") {
      const hasAccounts = !!(
        process.env.TTLOCK_ACCOUNTS_JSON ||
        (process.env.TTLOCK_USERNAME && process.env.TTLOCK_PASSWORD) ||
        (process.env.DDLOCK_USERNAME && process.env.DDLOCK_PASSWORD)
      );
      if (!hasAccounts) missing.push("TTLOCK_ACCOUNTS_JSON|TTLOCK_USERNAME|DDLOCK_USERNAME");
    }

    if (provider === "schlage") {
      const hasAccounts = !!(
        process.env.SCHLAGE_ACCOUNTS_JSON ||
        (process.env.SCHLAGE_EMAIL && process.env.SCHLAGE_PASSWORD)
      );
      if (!hasAccounts) missing.push("SCHLAGE_ACCOUNTS_JSON|SCHLAGE_EMAIL");
    }

    return missing;
  }

  isConfigured(provider: string): boolean {
    return this.missingEnv(provider).length === 0;
  }

  /**
   * Probe one provider by listing its devices. `listDevices` is the cheapest
   * call that exercises auth, network, and response parsing at once.
   */
  async checkProvider(provider: string): Promise<ProviderHealthResult> {
    const normalized = provider.toLowerCase();
    const missing = this.missingEnv(normalized);
    const now = new Date();

    if (missing.length > 0) {
      const error = `Missing environment variable(s): ${missing.join(", ")}`;
      await this.persist(normalized, {
        status: LockProviderHealth.UNCONFIGURED,
        isConfigured: false,
        lastCheckedAt: now,
        latencyMs: null,
        lastError: error,
        incrementFailure: false,
      });
      return {
        provider: normalized,
        status: LockProviderHealth.UNCONFIGURED,
        isConfigured: false,
        latencyMs: null,
        deviceCount: null,
        error,
      };
    }

    const startedAt = Date.now();
    try {
      const lockProvider = LockProviderFactory.getProvider(normalized);
      const devices = await lockProvider.listDevices();
      const latencyMs = Date.now() - startedAt;

      // Reachable but returning nothing usually means the account has no locks
      // paired yet, or the credentials point at the wrong tenant. Either way it
      // is not "healthy" in any sense the operator cares about.
      const status =
        devices.length === 0 || latencyMs > SLOW_PROBE_MS
          ? LockProviderHealth.DEGRADED
          : LockProviderHealth.OK;

      await this.persist(normalized, {
        status,
        isConfigured: true,
        lastCheckedAt: now,
        lastSuccessAt: now,
        latencyMs,
        lastError: null,
        resetFailures: true,
        metadata: { deviceCount: devices.length },
      });

      return {
        provider: normalized,
        status,
        isConfigured: true,
        latencyMs,
        deviceCount: devices.length,
        error: null,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startedAt;
      const message = error?.message || "Unknown error";
      logger.error(`[LockHealth] ${normalized} probe failed: ${message}`);

      await this.persist(normalized, {
        status: LockProviderHealth.ERROR,
        isConfigured: true,
        lastCheckedAt: now,
        latencyMs,
        lastError: message,
        incrementFailure: true,
      });

      return {
        provider: normalized,
        status: LockProviderHealth.ERROR,
        isConfigured: true,
        latencyMs,
        deviceCount: null,
        error: message,
      };
    }
  }

  /** Probe every registered provider. Failures are captured, never thrown. */
  async checkAllProviders(): Promise<ProviderHealthResult[]> {
    const providers = LockProviderFactory.getSupportedProviders();
    return Promise.all(providers.map((provider) => this.checkProvider(provider)));
  }

  /**
   * Report missing lock credentials at boot.
   *
   * These variables are read at construction time and default to empty strings,
   * so a misconfigured provider fails only when someone tries to program a door
   * — historically discovered by a guest standing outside it. Say so at startup
   * instead. Deliberately does not throw: an unset lock integration must not
   * stop the rest of the API from serving.
   */
  logCredentialReadiness(): void {
    for (const provider of LockProviderFactory.getSupportedProviders()) {
      const missing = this.missingEnv(provider);
      if (missing.length) {
        logger.warn(
          `[LockHealth] ${provider} is NOT configured — missing ${missing.join(", ")}. ` +
            "Locks on this provider cannot receive codes until these are set via GitHub secrets."
        );
      } else {
        logger.info(`[LockHealth] ${provider} credentials present`);
      }
    }
  }

  /**
   * Record the outcome of a device sync. Separate from `checkProvider` because a
   * sync is expensive and runs on its own schedule.
   */
  async recordSync(provider: string, deviceCount: number): Promise<void> {
    await this.persist(provider.toLowerCase(), {
      lastSyncAt: new Date(),
      lastSyncDeviceCount: deviceCount,
    });
  }

  /**
   * Return a row per supported provider, creating placeholders for any that have
   * never been probed so the UI always renders a complete integration list.
   */
  async getAllStatuses(): Promise<LockProviderStatus[]> {
    const supported = LockProviderFactory.getSupportedProviders();
    const existing = await this.statusRepository.find();
    const byProvider = new Map(existing.map((row) => [row.provider, row]));

    const result: LockProviderStatus[] = [];
    for (const provider of supported) {
      const row = byProvider.get(provider);
      if (row) {
        result.push(row);
        continue;
      }
      const configured = this.isConfigured(provider);
      result.push(
        this.statusRepository.create({
          provider,
          status: configured
            ? LockProviderHealth.UNKNOWN
            : LockProviderHealth.UNCONFIGURED,
          isConfigured: configured,
          lastSyncDeviceCount: 0,
          consecutiveFailures: 0,
        })
      );
    }
    return result;
  }

  private async persist(
    provider: string,
    updates: Partial<LockProviderStatus> & {
      incrementFailure?: boolean;
      resetFailures?: boolean;
    }
  ): Promise<void> {
    const { incrementFailure, resetFailures, ...fields } = updates;

    let row = await this.statusRepository.findOne({ where: { provider } });
    if (!row) {
      row = this.statusRepository.create({
        provider,
        consecutiveFailures: 0,
        lastSyncDeviceCount: 0,
      });
    }

    Object.assign(row, fields);
    if (resetFailures) row.consecutiveFailures = 0;
    if (incrementFailure) row.consecutiveFailures = (row.consecutiveFailures || 0) + 1;

    await this.statusRepository.save(row);
  }
}
