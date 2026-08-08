import path from "path";
import fs from "fs";
import { EufySecurity, EufySecurityConfig, Device } from "eufy-security-client";
import logger from "../utils/logger.utils";

/**
 * Multi-account Eufy cloud access.
 *
 * eufy-security-client speaks the same consumer cloud protocol as the Eufy
 * Security mobile app — no partner key, no per-device fee. Each configured
 * account (typically one for the main portfolio, more if some units are on
 * client-owned Eufy accounts) gets its own long-lived `EufySecurity` instance
 * so tokens and P2P sessions are reused across requests. Instantiating a
 * fresh client per request would trigger Eufy's rate-limiter and captcha
 * challenges within minutes.
 *
 * Auth challenges (captcha, TFA) can arrive at any login. We surface them
 * on the singleton and expose an admin endpoint that lets an operator hand
 * back the response — see `smartLockRoutes` `POST /smart-locks/eufy/challenge`.
 */

export interface EufyAccount {
  label: string;
  email: string;
  password: string;
  country?: string;
}

export type EufyChallengeStatus =
  | { status: "idle" }
  | { status: "captcha_pending"; captchaId: string; captchaImage: string }
  | { status: "tfa_pending" }
  | { status: "connecting" }
  | { status: "error"; message: string };

export function loadEufyAccounts(): EufyAccount[] {
  const raw = process.env.EUFY_ACCOUNTS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("EUFY_ACCOUNTS_JSON must be an array");
      }
      return parsed
        .map((row: any, index: number) => ({
          label: String(row.label || row.email || `account-${index + 1}`),
          email: String(row.email || "").trim().toLowerCase(),
          password: String(row.password || ""),
          country: row.country ? String(row.country) : undefined,
        }))
        .filter((row) => row.email && row.password);
    } catch (error: any) {
      logger.error(`[Eufy] Failed to parse EUFY_ACCOUNTS_JSON: ${error.message}`);
      return [];
    }
  }

  const email = (process.env.EUFY_EMAIL || "").trim().toLowerCase();
  const password = process.env.EUFY_PASSWORD || "";
  if (email && password) {
    return [{ label: "main", email, password, country: process.env.EUFY_COUNTRY }];
  }
  return [];
}

/**
 * Per-account client state. Shared between the provider and the challenge
 * admin endpoint so a captcha submitted via the endpoint completes the
 * connect() that a lock operation is blocked on.
 */
interface AccountRuntime {
  account: EufyAccount;
  client: EufySecurity | null;
  connectPromise: Promise<void> | null;
  challenge: EufyChallengeStatus;
  captchaResolver: ((code: string) => void) | null;
  tfaResolver: ((code: string) => void) | null;
}

export class EufyClientService {
  private static instance: EufyClientService | null = null;
  private runtimes = new Map<string, AccountRuntime>();

  static getInstance(): EufyClientService {
    if (!this.instance) this.instance = new EufyClientService();
    return this.instance;
  }

  private constructor() {}

  /**
   * Return the label of any account currently blocked on a challenge, or null.
   * The admin endpoint uses this to know where to route a response when the
   * caller doesn't supply an explicit label.
   */
  pendingChallengeAccount(): string | null {
    for (const [label, rt] of this.runtimes) {
      if (rt.challenge.status === "captcha_pending" || rt.challenge.status === "tfa_pending") {
        return label;
      }
    }
    return null;
  }

  getChallengeStatus(label: string): EufyChallengeStatus {
    return this.runtimes.get(label)?.challenge ?? { status: "idle" };
  }

  /**
   * Feed a captcha/TFA response back into a stalled connect() call.
   * Returns true if the response was consumed, false if no challenge is pending.
   */
  submitChallengeResponse(
    label: string,
    response: { captchaCode?: string; verifyCode?: string },
  ): boolean {
    const rt = this.runtimes.get(label);
    if (!rt) return false;

    if (rt.challenge.status === "captcha_pending" && response.captchaCode && rt.captchaResolver) {
      const resolver = rt.captchaResolver;
      rt.captchaResolver = null;
      rt.challenge = { status: "connecting" };
      resolver(response.captchaCode);
      return true;
    }
    if (rt.challenge.status === "tfa_pending" && response.verifyCode && rt.tfaResolver) {
      const resolver = rt.tfaResolver;
      rt.tfaResolver = null;
      rt.challenge = { status: "connecting" };
      resolver(response.verifyCode);
      return true;
    }
    return false;
  }

  /**
   * Get a connected client for the given account, initializing and logging
   * in on demand. Concurrent callers share the same in-flight connect().
   */
  async getClient(label: string): Promise<EufySecurity> {
    const rt = this.getOrCreateRuntime(label);

    if (rt.client) {
      return rt.client;
    }

    if (!rt.connectPromise) {
      rt.connectPromise = this.initAndConnect(rt).catch((err) => {
        rt.connectPromise = null;
        rt.challenge = { status: "error", message: err?.message || "connect failed" };
        throw err;
      });
    }
    await rt.connectPromise;
    if (!rt.client) throw new Error(`[Eufy] client for account "${label}" is not ready`);
    return rt.client;
  }

  /**
   * Get a device by serial number under the given account. The library
   * caches devices after the first listing, so this is cheap after warmup.
   */
  async getDevice(label: string, deviceSN: string): Promise<Device> {
    const client = await this.getClient(label);
    return client.getDevice(deviceSN);
  }

  async listDevices(label: string): Promise<Device[]> {
    const client = await this.getClient(label);
    return client.getDevices();
  }

  private getOrCreateRuntime(label: string): AccountRuntime {
    let rt = this.runtimes.get(label);
    if (rt) return rt;

    const account = loadEufyAccounts().find((row) => row.label === label);
    if (!account) {
      throw new Error(`[Eufy] no credentials configured for account "${label}"`);
    }
    rt = {
      account,
      client: null,
      connectPromise: null,
      challenge: { status: "idle" },
      captchaResolver: null,
      tfaResolver: null,
    };
    this.runtimes.set(label, rt);
    return rt;
  }

  private async initAndConnect(rt: AccountRuntime): Promise<void> {
    const persistentDir = this.ensurePersistentDir(rt.account.label);
    const config: EufySecurityConfig = {
      username: rt.account.email,
      password: rt.account.password,
      country: rt.account.country || "US",
      language: "en",
      trustedDeviceName: "SecureStay Server",
      persistentDir,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
    };

    rt.challenge = { status: "connecting" };
    rt.client = await EufySecurity.initialize(config);

    // Wire challenge handlers BEFORE calling connect — the events fire during
    // the connect() call itself and we need to be listening in time.
    rt.client.on("captcha request", (id: string, captcha: string) => {
      logger.warn(
        `[Eufy:${rt.account.label}] captcha requested (id=${id}); submit via ` +
          `POST /smart-locks/eufy/challenge { "label": "${rt.account.label}", "captchaCode": "..." }`,
      );
      rt.challenge = { status: "captcha_pending", captchaId: id, captchaImage: captcha };
      new Promise<string>((resolve) => {
        rt.captchaResolver = resolve;
      }).then((code) => {
        rt.client
          ?.connect({ captcha: { captchaId: id, captchaCode: code }, force: false })
          .catch((err) => {
            logger.error(`[Eufy:${rt.account.label}] connect after captcha failed: ${err?.message}`);
            rt.challenge = { status: "error", message: err?.message || "captcha connect failed" };
          });
      });
    });

    rt.client.on("tfa request", () => {
      logger.warn(
        `[Eufy:${rt.account.label}] 2FA requested; check email/SMS and submit via ` +
          `POST /smart-locks/eufy/challenge { "label": "${rt.account.label}", "verifyCode": "..." }`,
      );
      rt.challenge = { status: "tfa_pending" };
      new Promise<string>((resolve) => {
        rt.tfaResolver = resolve;
      }).then((code) => {
        rt.client
          ?.connect({ verifyCode: code, force: false })
          .catch((err) => {
            logger.error(`[Eufy:${rt.account.label}] connect after TFA failed: ${err?.message}`);
            rt.challenge = { status: "error", message: err?.message || "tfa connect failed" };
          });
      });
    });

    rt.client.on("connect", () => {
      logger.info(`[Eufy:${rt.account.label}] connected to Eufy cloud`);
      rt.challenge = { status: "idle" };
    });

    rt.client.on("connection error", (error: Error) => {
      logger.error(`[Eufy:${rt.account.label}] connection error: ${error.message}`);
      rt.challenge = { status: "error", message: error.message };
    });

    await rt.client.connect({ force: false });
  }

  private ensurePersistentDir(label: string): string {
    // Persist auth state under a per-label directory so multiple accounts
    // don't clobber each other. Falls back to /tmp if the configured path is
    // unwritable (deploy environments occasionally have odd permission
    // situations — we'd rather re-login than crash).
    const base =
      process.env.EUFY_PERSISTENT_DIR ||
      path.resolve(process.cwd(), ".eufy-state");
    const dir = path.join(base, label.replace(/[^a-zA-Z0-9_-]/g, "_"));
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (error: any) {
      logger.warn(`[Eufy:${label}] persistent dir ${dir} unwritable: ${error.message}; using /tmp`);
      const fallback = path.join("/tmp", `eufy-${label}`);
      fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    }
  }
}
