import { spawn } from "child_process";
import path from "path";
import logger from "../utils/logger.utils";

export interface SchlageAccount {
  label: string;
  email: string;
  password: string;
}

/**
 * Parse SCHLAGE_ACCOUNTS_JSON.
 *
 * Expected shape:
 * [{"label":"main","email":"a@b.com","password":"..."}, ...]
 *
 * Falls back to a single SCHLAGE_EMAIL / SCHLAGE_PASSWORD pair when the JSON
 * secret isn't set, so a one-account shop doesn't have to invent JSON.
 */
export function loadSchlageAccounts(): SchlageAccount[] {
  const raw = process.env.SCHLAGE_ACCOUNTS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("SCHLAGE_ACCOUNTS_JSON must be an array");
      }
      return parsed
        .map((row: any, index: number) => ({
          label: String(row.label || row.email || `account-${index + 1}`),
          email: String(row.email || "").trim().toLowerCase(),
          password: String(row.password || ""),
        }))
        .filter((row) => row.email && row.password);
    } catch (error: any) {
      logger.error(`[Schlage] Failed to parse SCHLAGE_ACCOUNTS_JSON: ${error.message}`);
      return [];
    }
  }

  const email = (process.env.SCHLAGE_EMAIL || "").trim().toLowerCase();
  const password = process.env.SCHLAGE_PASSWORD || "";
  if (email && password) {
    return [{ label: "main", email, password }];
  }
  return [];
}

export class SchlageBridgeService {
  // Deploy and local both run with cwd = secure-stay-server root. Do not resolve
  // relative to __dirname — in production that is dist/out-tsc/services.
  private scriptPath = path.resolve(process.cwd(), "scripts/schlage_cli.py");

  async run<T = any>(
    account: SchlageAccount,
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const body = JSON.stringify({
      action,
      email: account.email,
      password: account.password,
      ...payload,
    });

    return new Promise<T>((resolve, reject) => {
      const child = spawn("python3", [this.scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to start Schlage bridge: ${error.message}`));
      });

      child.on("close", (code) => {
        let parsed: any;
        try {
          parsed = JSON.parse(stdout.trim() || "{}");
        } catch {
          reject(
            new Error(
              `Schlage bridge returned non-JSON (exit ${code}): ${stdout || stderr || "empty"}`
            )
          );
          return;
        }

        if (!parsed.ok) {
          reject(new Error(parsed.error || `Schlage bridge failed (exit ${code})`));
          return;
        }
        resolve(parsed.data as T);
      });

      child.stdin.write(body);
      child.stdin.end();
    });
  }
}
