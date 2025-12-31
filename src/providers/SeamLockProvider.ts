import Seam from "seam";
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

/**
 * Seam Lock Provider Implementation
 * Implements ILockProvider interface for Seam API
 */
export class SeamLockProvider implements ILockProvider {
  readonly providerName = "seam";
  private apiKey: string;
  private seam: Seam;
  private baseUrl = "https://connect.getseam.com";

  constructor() {
    this.apiKey = process.env.SEAM_API_KEY || "";
    this.seam = new Seam({ apiKey: this.apiKey });
  }

  private getAxiosConfig() {
    return {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
  }

  async createConnectionUrl(options: ConnectionOptions): Promise<ConnectionResult> {
    const createdConnectWebview = await this.seam.connectWebviews.create({
      custom_redirect_url: options.redirectUrl || "",
      custom_redirect_failure_url: options.failureRedirectUrl || "",
      provider_category: (options.providerCategory as any) || "stable",
      accepted_providers: options.acceptedProviders as any,
      wait_for_device_creation: true,
    });

    return {
      connectWebviewId: createdConnectWebview.connect_webview_id,
      url: createdConnectWebview.url,
      status: createdConnectWebview.status,
    };
  }

  async getConnectionStatus(connectWebviewId: string): Promise<{
    status: string;
    connectedAccountId?: string;
  }> {
    const webview = await this.seam.connectWebviews.get({
      connect_webview_id: connectWebviewId,
    });

    return {
      status: webview.status,
      connectedAccountId: webview.connected_account_id || undefined,
    };
  }

  async listDevices(connectedAccountId?: string): Promise<Device[]> {
    const apiUrl = `${this.baseUrl}/devices/list`;
    const body: any = {};

    if (connectedAccountId) {
      body.connected_account_id = connectedAccountId;
    }

    const result = await axios.post(apiUrl, body, this.getAxiosConfig());
    const devices = result.data.devices || [];

    return devices.map((device: any) => this.mapSeamDeviceToDevice(device));
  }

  async getDevice(externalDeviceId: string): Promise<Device> {
    const apiUrl = `${this.baseUrl}/devices/get`;
    const body = { device_id: externalDeviceId };

    const result = await axios.post(apiUrl, body, this.getAxiosConfig());
    return this.mapSeamDeviceToDevice(result.data.device);
  }

  async createAccessCode(params: CreateAccessCodeParams): Promise<ProviderAccessCode> {
    const apiUrl = `${this.baseUrl}/access_codes/create`;

    const body: any = {
      device_id: params.deviceId,
      code: params.code,
      name: params.name,
    };

    if (params.startsAt) {
      body.starts_at = params.startsAt;
    }
    if (params.endsAt) {
      body.ends_at = params.endsAt;
    }

    const result = await axios.post(apiUrl, body, this.getAxiosConfig());
    return this.mapSeamAccessCodeToProviderAccessCode(result.data.access_code);
  }

  async updateAccessCode(
    externalCodeId: string,
    params: UpdateAccessCodeParams
  ): Promise<ProviderAccessCode> {
    const apiUrl = `${this.baseUrl}/access_codes/update`;

    const body: any = {
      access_code_id: externalCodeId,
    };

    if (params.code) body.code = params.code;
    if (params.name) body.name = params.name;
    if (params.startsAt) body.starts_at = params.startsAt;
    if (params.endsAt) body.ends_at = params.endsAt;

    const result = await axios.post(apiUrl, body, this.getAxiosConfig());
    return this.mapSeamAccessCodeToProviderAccessCode(result.data.access_code);
  }

  async deleteAccessCode(externalCodeId: string): Promise<void> {
    const apiUrl = `${this.baseUrl}/access_codes/delete`;
    const body = { access_code_id: externalCodeId };

    await axios.post(apiUrl, body, this.getAxiosConfig());
  }

  async listAccessCodes(externalDeviceId: string): Promise<ProviderAccessCode[]> {
    const apiUrl = `${this.baseUrl}/access_codes/list`;
    const body = { device_id: externalDeviceId };

    const result = await axios.post(apiUrl, body, this.getAxiosConfig());
    const accessCodes = result.data.access_codes || [];

    return accessCodes.map((code: any) =>
      this.mapSeamAccessCodeToProviderAccessCode(code)
    );
  }

  private mapSeamDeviceToDevice(seamDevice: any): Device {
    const props = seamDevice.properties || {};

    return {
      externalDeviceId: seamDevice.device_id,
      provider: this.providerName,
      connectedAccountId: seamDevice.connected_account_id,
      deviceName: seamDevice.display_name || props.name || props.appearance?.name,
      deviceType: seamDevice.device_type,
      manufacturer: props.manufacturer,
      model: props.model?.display_name,
      locationName: seamDevice.location?.location_name,
      isOnline: props.online ?? true,
      capabilities: seamDevice.capabilities_supported,
      // Battery info
      batteryLevel: props.battery?.level ?? props.battery_level,
      batteryStatus: props.battery?.status,
      // Lock status
      isLocked: props.locked,
      isDoorOpen: props.door_open,
      // Additional info
      serialNumber: props.serial_number,
      imageUrl: props.image_url,
      providerMetadata: {
        workspace_id: seamDevice.workspace_id,
        properties: props,
        errors: seamDevice.errors,
        warnings: seamDevice.warnings,
      },
    };
  }

  private mapSeamAccessCodeToProviderAccessCode(seamCode: any): ProviderAccessCode {
    return {
      externalCodeId: seamCode.access_code_id,
      code: seamCode.code,
      name: seamCode.name,
      status: seamCode.status,
      startsAt: seamCode.starts_at,
      endsAt: seamCode.ends_at,
      providerMetadata: {
        type: seamCode.type,
        is_managed: seamCode.is_managed,
        is_scheduled_on_device: seamCode.is_scheduled_on_device,
        errors: seamCode.errors,
        warnings: seamCode.warnings,
      },
    };
  }
}
