import { ILockProvider } from "../interfaces/ILockProvider";
import { SeamLockProvider } from "./SeamLockProvider";
import { SifelyLockProvider } from "./SifelyLockProvider";
import { SchlageLockProvider } from "./SchlageLockProvider";
import { TTLockLockProvider } from "./TTLockLockProvider";
import { EufyLockProvider } from "./EufyLockProvider";

/**
 * Lock Provider Factory
 * Returns the appropriate provider implementation based on provider name
 */
export class LockProviderFactory {
  private static providers: Map<string, ILockProvider> = new Map();

  /**
   * Get a lock provider by name
   * Uses singleton pattern for each provider
   */
  static getProvider(providerName: string): ILockProvider {
    const normalizedName = providerName.toLowerCase();

    if (this.providers.has(normalizedName)) {
      return this.providers.get(normalizedName)!;
    }

    let provider: ILockProvider;

    switch (normalizedName) {
      case "seam":
        provider = new SeamLockProvider();
        break;
      case "sifely":
        provider = new SifelyLockProvider();
        break;
      case "schlage":
        provider = new SchlageLockProvider();
        break;
      case "ttlock":
        provider = new TTLockLockProvider();
        break;
      case "eufy":
        provider = new EufyLockProvider();
        break;
      default:
        throw new Error(`Unknown lock provider: ${providerName}`);
    }

    this.providers.set(normalizedName, provider);
    return provider;
  }

  /**
   * Providers we actively sync and health-check.
   * Seam is still constructible for disconnect/legacy devices but is not in
   * the active set — per-device pricing was rejected for this fleet.
   */
  static getSupportedProviders(): string[] {
    return ["sifely", "ttlock", "schlage", "eufy"];
  }

  static isProviderSupported(providerName: string): boolean {
    return this.getSupportedProviders().includes(providerName.toLowerCase());
  }
}
