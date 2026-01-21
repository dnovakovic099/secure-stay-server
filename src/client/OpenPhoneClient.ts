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
      paramsSerializer: {
        serialize: (params) => {
          const searchParams = new URLSearchParams();
          for (const key in params) {
            const value = params[key];
            if (Array.isArray(value)) {
              for (const item of value) {
                searchParams.append(key, item);
              }
            } else if (value !== undefined) {
              searchParams.append(key, value);
            }
          }
          return searchParams.toString();
        }
      }
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
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone createContact error: ${errorMsg}`, { error: error.response?.data || error });
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
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone sendSMS error: ${errorMsg}`, { error: error.response?.data || error });
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
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getPhoneNumbers error: ${errorMsg}`, { error: error.response?.data || error });
      throw error;
    }
  }

  /**
   * Get conversations, optionally filtered by participant phone number
   * @param filters Optional filters for phone numbers and date range
   * @returns List of conversations
   */
  async getConversations(filters?: {
    phoneNumberId?: string | string[];
    participants?: string[];
    createdAfter?: string;
  }): Promise<GetConversationsResponse> {
    try {
      const params: Record<string, any> = {};
      if (filters?.phoneNumberId) params.phoneNumberId = filters.phoneNumberId;
      if (filters?.participants) params.participants = filters.participants;
      if (filters?.createdAfter) params.createdAfter = filters.createdAfter;

      const response = await this.client.get<GetConversationsResponse>("/conversations", { params });
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getConversations error: ${errorMsg}`, { error: error.response?.data || error });
      throw error;
    }
  }

  /**
   * Get messages, optionally filtered by conversation, participants, or phone number
   * @param filters Optional filters
   * @returns List of messages
   */
  async getMessages(filters?: {
    phoneNumberId?: string | string[];
    participants?: string[];
    conversationId?: string;
    createdAfter?: string;
  }): Promise<GetMessagesResponse> {
    const params: Record<string, any> = {};
    if (filters?.phoneNumberId) params.phoneNumberId = filters.phoneNumberId;
    if (filters?.participants) params.participants = filters.participants;
    if (filters?.conversationId) params.conversationId = filters.conversationId;
    if (filters?.createdAfter) params.createdAfter = filters.createdAfter;

    try {
      logger.info(`OpenPhone getMessages params: ${JSON.stringify(params)}`);
      const response = await this.client.get<GetMessagesResponse>("/messages", { params });
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getMessages error: ${errorMsg}`, { error: error.response?.data || error, params });
      throw error;
    }
  }

  /**
   * Get list of calls, optionally filtered
   * @param filters Optional filters
   * @returns List of calls
   */
  async getCalls(filters?: {
    phoneNumberId?: string | string[];
    participants?: string[];
    createdAfter?: string;
  }): Promise<GetCallsResponse> {
    const params: Record<string, any> = {};
    if (filters?.phoneNumberId) params.phoneNumberId = filters.phoneNumberId;
    if (filters?.participants) params.participants = filters.participants;
    if (filters?.createdAfter) params.createdAfter = filters.createdAfter;

    try {
      logger.info(`OpenPhone getCalls params: ${JSON.stringify(params)}`);
      const response = await this.client.get<GetCallsResponse>("/calls", { params });
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getCalls error: ${errorMsg}`, { error: error.response?.data || error, params });
      throw error;
    }
  }

  /**
   * Get a specific call by ID
   * @param callId The call ID
   * @returns Call details
   */
  async getCallById(callId: string): Promise<GetCallResponse> {
    try {
      const response = await this.client.get<GetCallResponse>(`/calls/${callId}`);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getCallById error: ${errorMsg}`, { error: error.response?.data || error });
      throw error;
    }
  }

  /**
   * Get the AI-generated summary for a call
   * @param callId The call ID
   * @returns Call summary
   */
  async getCallSummary(callId: string): Promise<GetCallSummaryResponse> {
    try {
      const response = await this.client.get<GetCallSummaryResponse>(`/call-summaries/${callId}`);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getCallSummary error: ${errorMsg}`, { error: error.response?.data || error });
      throw error;
    }
  }

  /**
   * Get the transcript for a call
   * @param callId The call ID
   * @returns Call transcript
   */
  async getCallTranscript(callId: string): Promise<GetCallTranscriptResponse> {
    try {
      const response = await this.client.get<GetCallTranscriptResponse>(`/call-transcripts/${callId}`);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`OpenPhone getCallTranscript error: ${errorMsg}`, { error: error.response?.data || error });
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

// --- Conversation and Message Types ---

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  participants: string[];
  phoneNumberId: string;
  lastMessage?: {
    id: string;
    text: string;
    createdAt: string;
    direction: "incoming" | "outgoing";
  };
}

export interface GetConversationsResponse {
  data: Conversation[];
}

export interface Message {
  id: string;
  conversationId: string;
  text: string;
  from: string;
  to: string[];
  direction: "incoming" | "outgoing";
  status: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  media?: Array<{
    url: string;
    type: string;
  }>;
}

export interface GetMessagesResponse {
  data: Message[];
}

// --- Call Types ---

export interface Call {
  id: string;
  phoneNumberId: string;
  from: string;
  to: string;
  direction: "incoming" | "outgoing";
  status: string;
  duration?: number;
  answeredAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  voicemail?: {
    id: string;
    duration: number;
    url: string;
  };
}

export interface GetCallsResponse {
  data: Call[];
}

export interface GetCallResponse {
  data: Call;
}

export interface CallSummary {
  id: string;
  callId: string;
  summary: string;
  createdAt: string;
}

export interface GetCallSummaryResponse {
  data: CallSummary;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface CallTranscript {
  id: string;
  callId: string;
  segments: TranscriptSegment[];
  text: string;
  createdAt: string;
}

export interface GetCallTranscriptResponse {
  data: CallTranscript;
}
