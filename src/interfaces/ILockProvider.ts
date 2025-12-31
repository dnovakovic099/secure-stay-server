/**
 * Lock Provider Interface
 * Defines the contract for smart lock providers (Seam, August, etc.)
 */

export interface ConnectionOptions {
  redirectUrl?: string;
  failureRedirectUrl?: string;
  providerCategory?: string;
  acceptedProviders?: string[];
}

export interface ConnectionResult {
  connectWebviewId: string;
  url: string;
  status: string;
}

export interface ConnectedAccount {
  connectedAccountId: string;
  provider: string;
  email?: string;
  accountType?: string;
}

export interface Device {
  externalDeviceId: string;
  provider: string;
  connectedAccountId?: string;
  deviceName?: string;
  deviceType?: string;
  manufacturer?: string;
  model?: string;
  locationName?: string;
  isOnline?: boolean;
  capabilities?: object;
  providerMetadata?: object;
  // Additional status fields
  batteryLevel?: number; // 0-1 decimal
  batteryStatus?: string; // critical, low, good, full
  isLocked?: boolean;
  isDoorOpen?: boolean;
  serialNumber?: string;
  imageUrl?: string;
}

export interface CreateAccessCodeParams {
  deviceId: string;
  code: string;
  name: string;
  startsAt?: string;
  endsAt?: string;
}

export interface UpdateAccessCodeParams {
  code?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface ProviderAccessCode {
  externalCodeId: string;
  code: string;
  name?: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  providerMetadata?: object;
}

export interface ILockProvider {
  readonly providerName: string;

  /**
   * Creates a connection URL for the user to authorize their lock account
   */
  createConnectionUrl(options: ConnectionOptions): Promise<ConnectionResult>;

  /**
   * Gets the status of a connection webview
   */
  getConnectionStatus(connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }>;

  /**
   * Lists all devices for a connected account
   */
  listDevices(connectedAccountId?: string): Promise<Device[]>;

  /**
   * Gets a single device by its external ID
   */
  getDevice(externalDeviceId: string): Promise<Device>;

  /**
   * Creates an access code on a device
   */
  createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode>;

  /**
   * Updates an existing access code
   */
  updateAccessCode(
    externalCodeId: string,
    params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode>;

  /**
   * Deletes an access code
   */
  deleteAccessCode(externalCodeId: string): Promise<void>;

  /**
   * Lists all access codes for a device
   */
  listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]>;
}
