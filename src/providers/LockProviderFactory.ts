import { ILockProvider } from "../interfaces/ILockProvider";
import { SeamLockProvider } from "./SeamLockProvider";

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

    // Return cached instance if exists
    if (this.providers.has(normalizedName)) {
      return this.providers.get(normalizedName)!;
    }

    // Create new instance based on provider name
    let provider: ILockProvider;

    switch (normalizedName) {
      case "seam":
        provider = new SeamLockProvider();
        break;
      // Add future providers here:
      // case "august":
      //   provider = new AugustLockProvider();
      //   break;
      // case "yale":
      //   provider = new YaleLockProvider();
      //   break;
      default:
        throw new Error(`Unknown lock provider: ${providerName}`);
    }

    // Cache and return
    this.providers.set(normalizedName, provider);
    return provider;
  }

  /**
   * Get list of supported provider names
   */
  static getSupportedProviders(): string[] {
    return ["seam"];
    // Add more providers as they are implemented
  }

  /**
   * Check if a provider is supported
   */
  static isProviderSupported(providerName: string): boolean {
    return this.getSupportedProviders().includes(providerName.toLowerCase());
  }
}
