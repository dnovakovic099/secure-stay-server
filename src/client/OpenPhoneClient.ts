import axios, { AxiosInstance } from "axios";
import logger from "../utils/logger.utils";

/**
 * OpenPhone API Client
 * Handles API communication with OpenPhone for contacts and messaging
 * API Documentation: https://www.openphone.com/docs/api-reference
 */
export class OpenPhoneClient {
  private client: AxiosInstance;
  private baseUrl = "https://api.openphone.com/v1";

  constructor() {
    const apiKey = process.env.OPEN_PHONE_API_KEY;

    if (!apiKey) {
      logger.warn("OpenPhone API key not configured. OpenPhone integration will be disabled.");
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Authorization": apiKey || "",
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Check if OpenPhone integration is configured
   */
  isConfigured(): boolean {
    return !!process.env.OPEN_PHONE_API_KEY;
  }

  /**
   * Create a contact in OpenPhone
   * @param contactData Contact data matching OpenPhone API format
   * @returns Created contact response
   */
  async createContact(contactData: CreateContactRequest): Promise<CreateContactResponse> {
    try {
      const response = await this.client.post<CreateContactResponse>("/contacts", contactData);
      return response.data;
    } catch (error: any) {
      logger.error("OpenPhone createContact error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send an SMS message via OpenPhone
   * @param messageData Message data including recipient and content
   * @returns Sent message response
   */
  async sendSMS(messageData: SendSMSRequest): Promise<SendSMSResponse> {
    try {
      const response = await this.client.post<SendSMSResponse>("/messages", messageData);
      return response.data;
    } catch (error: any) {
      logger.error("OpenPhone sendSMS error:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get list of phone numbers associated with the account
   * @returns List of phone numbers
   */
  async getPhoneNumbers(): Promise<GetPhoneNumbersResponse> {
    try {
      const response = await this.client.get<GetPhoneNumbersResponse>("/phone-numbers");
      return response.data;
    } catch (error: any) {
      logger.error("OpenPhone getPhoneNumbers error:", error.response?.data || error.message);
      throw error;
    }
  }
}

// --- Type Definitions ---

export interface ContactDefaultFields {
  firstName?: string;
  lastName?: string;
  company?: string;
  emails?: Array<{
    name?: string;
    value: string;
  }>;
  phoneNumbers?: Array<{
    name?: string;
    value: string;
  }>;
  role?: string;
}

export interface ContactCustomField {
  key: string;
  value: string | string[] | number | null;
}

export interface CreateContactRequest {
  defaultFields: ContactDefaultFields;
  customFields?: ContactCustomField[];
  externalId?: string;
  source?: string;
  sourceUrl?: string;
  createdByUserId?: string;
}

export interface CreateContactResponse {
  data: {
    id: string;
    externalId?: string;
    source?: string;
    sourceUrl?: string;
    defaultFields: ContactDefaultFields;
    customFields?: Array<{
      id: string;
      key: string;
      name: string;
      type: string;
      value: string | string[] | number | null;
    }>;
    createdAt: string;
    updatedAt: string;
    createdByUserId?: string;
  };
}

export interface SendSMSRequest {
  content: string;
  from: string;
  to: string[];
  userId?: string;
  setInboxStatus?: "done";
}

export interface SendSMSResponse {
  data: {
    id: string;
    to: string[];
    from: string;
    text: string;
    phoneNumberId?: string;
    direction: "incoming" | "outgoing";
    userId?: string;
    status: "queued" | "sent" | "delivered" | "undelivered";
    createdAt: string;
    updatedAt: string;
  };
}

export interface GetPhoneNumbersResponse {
  data: Array<{
    id: string;
    name?: string;
    number: string;
    formattedNumber?: string;
    type: string;
    status: string;
  }>;
}
