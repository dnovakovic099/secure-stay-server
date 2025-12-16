import { OpenPhoneClient, CreateContactRequest, ContactCustomField } from "../client/OpenPhoneClient";
import { ClientEntity } from "../entity/Client";
import logger from "../utils/logger.utils";

/**
 * OpenPhone Service
 * Handles business logic for OpenPhone integration
 */
export class OpenPhoneService {
  private client: OpenPhoneClient;

  // OpenPhone Custom Field Keys (from OpenPhone workspace)
  private static readonly CUSTOM_FIELD_KEYS = {
    FULL_NAME: "68aca28475411ca60a059d43",
    ADDRESS: "687d642ef6ce894a6de55e34",
    TIME_ZONE: "687d6e45f6ce894a6de564ec",
    SERVICE_TYPE: "687d67c4f6ce894a6de56096",
    AIRDNA: "67ffc1cab4c2ac5f5f6856dc",
    // Deferred for now:
    // PAYOUT: "68ad0bbbf8e32e39c376a786",
    // CLIENT_PROFILE: "687d68b7f6ce894a6de561cd",
    // TAGS: "689052beea72c906de0b83ef",
  };

  // Timezone mapping
  private static readonly TIMEZONE_MAP: Record<string, string> = {
    "EASTERN": "EST/EDT",
    "CENTRAL": "CST/CDT (-1 EST)",
    "MOUNTAIN": "MST/MDT (-2 EST)",
    "PACIFIC": "PST/PDT (-3 EST)",
  };

  constructor() {
    this.client = new OpenPhoneClient();
  }

  /**
   * Check if OpenPhone integration is configured
   */
  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /**
   * Create a contact in OpenPhone from client and property data
   * @param client Client entity
   * @param properties Property data array (includes address, serviceInfo, onboarding)
   * @returns Created contact or null if not configured
   */
  async createContactFromClient(
    client: ClientEntity,
    properties: any[]
  ): Promise<any> {
    if (!this.isConfigured()) {
      logger.info("OpenPhone not configured, skipping contact creation");
      return null;
    }

    try {
      // Get first property for address and other info
      const firstProperty = properties[0];
      const serviceInfo = firstProperty?.onboarding?.serviceInfo;
      const onboarding = firstProperty?.onboarding;

      // Build phone number in E.164 format
      const phoneNumber = this.formatPhoneNumber(client.dialCode, client.phone);

      // Build contact request
      const contactRequest: CreateContactRequest = {
        defaultFields: {
          firstName: client.firstName || undefined,
          lastName: client.lastName || undefined,
          company: "OWNER", // Default value as per requirements
          phoneNumbers: phoneNumber ? [{ name: "Mobile", value: phoneNumber }] : undefined,
          emails: client.email ? [{ name: "Primary", value: client.email }] : undefined,
        },
        customFields: this.buildCustomFields(client, firstProperty, serviceInfo, onboarding),
        externalId: client.id, // Use client ID as external reference
        source: "secure-stay",
      };

      const response = await this.client.createContact(contactRequest);
      logger.info(`OpenPhone contact created successfully for client: ${client.id}`);
      return response;
    } catch (error: any) {
      logger.error(`Failed to create OpenPhone contact for client ${client.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Send an SMS message
   * @param to Recipient phone number in E.164 format
   * @param content Message content
   * @returns Sent message response
   */
  async sendSMS(to: string, content: string): Promise<any> {
    if (!this.isConfigured()) {
      logger.info("OpenPhone not configured, skipping SMS");
      return null;
    }

    const senderNumber = process.env.OPEN_PHONE_SENDER_NUMBER;
    if (!senderNumber) {
      logger.warn("OPEN_PHONE_SENDER_NUMBER not configured, cannot send SMS");
      return null;
    }

    try {
      const response = await this.client.sendSMS({
        content,
        from: senderNumber,
        to: [to],
      });
      logger.info(`SMS sent successfully to: ${to}`);
      return response;
    } catch (error: any) {
      logger.error(`Failed to send SMS to ${to}:`, error.message);
      throw error;
    }
  }

  /**
   * Format phone number to E.164 format
   * @param dialCode Dial code (e.g., "+1")
   * @param phone Phone number (e.g., "2345678901")
   * @returns E.164 formatted number (e.g., "+12345678901")
   */
  private formatPhoneNumber(dialCode?: string, phone?: string): string | null {
    if (!phone) return null;

    // Clean the phone number (remove spaces, dashes, parentheses)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, "");

    // If dialCode is provided, combine them
    if (dialCode) {
      // Ensure dialCode starts with +
      const cleanDialCode = dialCode.startsWith("+") ? dialCode : `+${dialCode}`;
      return `${cleanDialCode}${cleanPhone}`;
    }

    // If phone already has +, return as is
    if (cleanPhone.startsWith("+")) {
      return cleanPhone;
    }

    // Default to US if no dial code (assume +1)
    return `+1${cleanPhone}`;
  }

  /**
   * Map timezone from database format to OpenPhone format
   * @param timezone Database timezone value
   * @returns OpenPhone timezone value
   */
  private mapTimezone(timezone?: string): string | null {
    if (!timezone) return null;

    const upperTimezone = timezone.toUpperCase();
    return OpenPhoneService.TIMEZONE_MAP[upperTimezone] || timezone;
  }

  /**
   * Build custom fields array for OpenPhone API
   */
  private buildCustomFields(
    client: ClientEntity,
    property: any,
    serviceInfo: any,
    onboarding: any
  ): ContactCustomField[] {
    const customFields: ContactCustomField[] = [];

    // Full Name (string)
    const fullName = [client.firstName, client.lastName].filter(Boolean).join(" ");
    if (fullName) {
      customFields.push({
        key: OpenPhoneService.CUSTOM_FIELD_KEYS.FULL_NAME,
        value: fullName,
      });
    }

    // Address (address type - pass as string)
    if (property?.address) {
      customFields.push({
        key: OpenPhoneService.CUSTOM_FIELD_KEYS.ADDRESS,
        value: property.address,
      });
    }

    // Time Zone (multi-select)
    const mappedTimezone = this.mapTimezone(client.timezone);
    if (mappedTimezone) {
      customFields.push({
        key: OpenPhoneService.CUSTOM_FIELD_KEYS.TIME_ZONE,
        value: [mappedTimezone], // Multi-select expects array
      });
    }

    // Service Type (multi-select)
    if (serviceInfo?.serviceType) {
      customFields.push({
        key: OpenPhoneService.CUSTOM_FIELD_KEYS.SERVICE_TYPE,
        value: [serviceInfo.serviceType], // Multi-select expects array
      });
    }

    // AirDNA / Projected Revenue (url type - pass the value as string)
    if (onboarding?.sales?.projectedRevenue || property?.onboarding?.projectedRevenue) {
      const projectedRevenue = onboarding?.sales?.projectedRevenue || property?.onboarding?.projectedRevenue;
      customFields.push({
        key: OpenPhoneService.CUSTOM_FIELD_KEYS.AIRDNA,
        value: String(projectedRevenue),
      });
    }

    return customFields;
  }
}
