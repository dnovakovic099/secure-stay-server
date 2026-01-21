import { appDatabase } from "../utils/database.util";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { OpenPhoneClient, Message as OpenPhoneMessage, Call } from "../client/OpenPhoneClient";
import { Hostify, HostifyInboxThread } from "../client/Hostify";
import logger from "../utils/logger.utils";
import { v4 as uuidv4 } from "uuid";

/**
 * GuestCommunicationService
 * Aggregates and stores communication data from OpenPhone and Hostify
 */
export class GuestCommunicationService {
    private openPhoneClient: OpenPhoneClient;
    private hostifyClient: Hostify;
    private communicationRepo = appDatabase.getRepository(GuestCommunicationEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    constructor() {
        this.openPhoneClient = new OpenPhoneClient();
        this.hostifyClient = new Hostify();
    }

    /**
     * Fetch and store communications from OpenPhone for a reservation
     * Looks up guest by phone number from reservation info
     */
    async fetchAndStoreFromOpenPhone(reservationId: number): Promise<GuestCommunicationEntity[]> {
        const reservation = await this.reservationRepo.findOne({
            where: { id: reservationId }
        });

        if (!reservation || !reservation.phone) {
            logger.warn(`[GuestCommunicationService] No phone found for reservation ${reservationId}`);
            return [];
        }

        if (!this.openPhoneClient.isConfigured()) {
            logger.warn("[GuestCommunicationService] OpenPhone not configured");
            return [];
        }

        const guestPhone = this.normalizePhoneNumber(reservation.phone);
        const storedCommunications: GuestCommunicationEntity[] = [];

        try {
            // Get account phone numbers (required for filtering messages/calls)
            const phoneNumbers = await this.openPhoneClient.getPhoneNumbers();
            const phoneNumberIds = phoneNumbers.data?.map(p => p.id) || [];

            if (phoneNumberIds.length === 0) {
                logger.warn("[GuestCommunicationService] No phone numbers found in OpenPhone account");
                return [];
            }

            // Fetch all SMS messages with guest - Iterate through phone numbers since API expects singular ID
            for (const pnId of phoneNumberIds) {
                try {
                    const messages = await this.openPhoneClient.getMessages({
                        participants: [guestPhone],
                        phoneNumberId: pnId
                    });

                    for (const msg of messages.data || []) {
                        const existing = await this.communicationRepo.findOne({
                            where: { externalId: msg.id, source: "openphone_sms" }
                        });
                        if (!existing) {
                            const comm = await this.storeCommunication({
                                reservationId,
                                source: "openphone_sms",
                                externalId: msg.id,
                                content: msg.text || "",
                                direction: msg.direction === "incoming" ? "inbound" : "outbound",
                                senderName: msg.direction === "incoming" ? reservation.guestName : "Representative",
                                senderPhone: msg.from,
                                communicatedAt: new Date(msg.createdAt),
                                metadata: { conversationId: msg.conversationId, phoneNumberId: pnId }
                            });
                            storedCommunications.push(comm);
                        }
                    }
                } catch (error) {
                    // Log but continue with other phone numbers
                    logger.error(`[GuestCommunicationService] Error fetching messages for PN ${pnId}:`, error.message);
                }
            }

            // Fetch calls with guest - Iterate through phone numbers
            for (const pnId of phoneNumberIds) {
                try {
                    const calls = await this.openPhoneClient.getCalls({
                        participants: [guestPhone],
                        phoneNumberId: pnId
                    });

                    for (const call of calls.data || []) {
                        const existing = await this.communicationRepo.findOne({
                            where: { externalId: call.id, source: "openphone_call" }
                        });
                        if (!existing) {
                            // Try to get call summary or transcript
                            let content = `Call ${call.direction} - Duration: ${call.duration || 0}s`;
                            try {
                                const summary = await this.openPhoneClient.getCallSummary(call.id);
                                if (summary?.data?.summary) {
                                    content = summary.data.summary;
                                }
                            } catch {
                                // Summary not available, try transcript
                                try {
                                    const transcript = await this.openPhoneClient.getCallTranscript(call.id);
                                    if (transcript?.data?.text) {
                                        content = transcript.data.text;
                                    }
                                } catch {
                                    // Use default content
                                }
                            }

                            const comm = await this.storeCommunication({
                                reservationId,
                                source: "openphone_call",
                                externalId: call.id,
                                content,
                                direction: call.direction === "incoming" ? "inbound" : "outbound",
                                senderName: call.direction === "incoming" ? reservation.guestName : "Representative",
                                senderPhone: call.from,
                                communicatedAt: new Date(call.createdAt),
                                metadata: {
                                    duration: call.duration,
                                    status: call.status,
                                    hasVoicemail: !!call.voicemail,
                                    phoneNumberId: pnId
                                }
                            });
                            storedCommunications.push(comm);
                        }
                    }
                } catch (error) {
                    logger.error(`[GuestCommunicationService] Error fetching calls for PN ${pnId}:`, error.message);
                }
            }

            logger.info(`[GuestCommunicationService] Stored ${storedCommunications.length} OpenPhone communications for reservation ${reservationId}`);
            return storedCommunications;
        } catch (error: any) {
            const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            logger.error(`[GuestCommunicationService] Error fetching OpenPhone data: ${errorDetail}`, { error });
            return storedCommunications;
        }
    }

    /**
     * Fetch and store communications from Hostify inbox
     */
    async fetchAndStoreFromHostify(reservationId: number, inboxId?: string): Promise<GuestCommunicationEntity[]> {
        const apiKey = process.env.HOSTIFY_API_KEY;
        if (!apiKey) {
            logger.warn("[GuestCommunicationService] Hostify API key not configured");
            return [];
        }

        let actualInboxId = inboxId;

        // If inboxId not provided, fetch it from Hostify reservation info
        if (!actualInboxId) {
            try {
                logger.info(`[GuestCommunicationService] Fetching inboxId from Hostify for reservation ${reservationId}`);
                const hostifyRes = await this.hostifyClient.getReservationInfo(apiKey, reservationId);
                if (hostifyRes && hostifyRes.reservation?.message_id) {
                    actualInboxId = String(hostifyRes.reservation.message_id);
                    logger.info(`[GuestCommunicationService] Discovered inboxId ${actualInboxId} for reservation ${reservationId}`);
                } else {
                    logger.warn(`[GuestCommunicationService] No message_id found in Hostify reservation info for ${reservationId}`);
                    return [];
                }
            } catch (error: any) {
                const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                logger.error(`[GuestCommunicationService] Error fetching reservation info from Hostify: ${errorDetail}`, { error });
                return [];
            }
        }

        const reservation = await this.reservationRepo.findOne({
            where: { id: reservationId }
        });

        const storedCommunications: GuestCommunicationEntity[] = [];

        try {
            const inboxThread = await this.hostifyClient.getInboxThread(apiKey, actualInboxId!);
            if (!inboxThread || !inboxThread.messages || inboxThread.messages.length === 0) {
                logger.warn(`[GuestCommunicationService] No messages found in Hostify inbox ${actualInboxId}`);
                return [];
            }


            for (const msg of inboxThread.messages) {
                // Handle potential key variations from Hostify (camelCase vs snake_case)
                const msgId = msg.id || (msg as any).message_id;
                const msgContent = msg.message || (msg as any).text || "";
                const msgCreatedAt = msg.createdAt || (msg as any).created_at || (msg as any).timestamp;
                const msgSenderType = msg.senderType || (msg as any).sender_type;
                const msgSender = msg.sender || (msg as any).sender_name;

                const existing = await this.communicationRepo.findOne({
                    where: { externalId: `hostify_${msgId}`, source: "hostify_message" }
                });
                if (!existing) {
                    const direction = msgSenderType === "guest" ? "inbound" : "outbound";
                    const senderName = msgSenderType === "guest"
                        ? (inboxThread.guestName || reservation?.guestName || "Guest")
                        : msgSender || "Representative";

                    // Ensure we have a valid date
                    let communicatedAt = new Date(msgCreatedAt);
                    if (isNaN(communicatedAt.getTime())) {
                        communicatedAt = new Date();
                    }

                    const comm = await this.storeCommunication({
                        reservationId,
                        source: "hostify_message",
                        externalId: `hostify_${msgId}`,
                        content: msgContent,
                        direction,
                        senderName,
                        senderPhone: inboxThread.guestPhone || null,
                        communicatedAt,
                        metadata: {
                            inboxId: actualInboxId,
                            channel: msg.channel || (msg as any).provider,
                            senderType: msgSenderType
                        }
                    });
                    storedCommunications.push(comm);
                }
            }

            logger.info(`[GuestCommunicationService] Stored ${storedCommunications.length} Hostify messages for reservation ${reservationId}`);
            return storedCommunications;
        } catch (error: any) {
            const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            logger.error(`[GuestCommunicationService] Error fetching Hostify data: ${errorDetail}`, { error });
            return storedCommunications;
        }
    }

    /**
     * Get all communications for a reservation
     */
    async getAllCommunicationsForReservation(reservationId: number): Promise<GuestCommunicationEntity[]> {
        return this.communicationRepo.find({
            where: { reservationId },
            order: { communicatedAt: "ASC" }
        });
    }

    /**
     * Build a formatted communication timeline for AI analysis
     */
    async buildCommunicationTimeline(reservationId: number): Promise<string> {
        const communications = await this.getAllCommunicationsForReservation(reservationId);

        if (communications.length === 0) {
            return "No communications found for this reservation.";
        }

        const lines: string[] = ["## Communication Timeline\n"];

        for (const comm of communications) {
            const timestamp = comm.communicatedAt.toISOString().replace("T", " ").substring(0, 19);
            const directionLabel = comm.direction === "inbound" ? "GUEST" : "REP";
            const sourceLabel = this.formatSource(comm.source);

            lines.push(`[${timestamp}] [${sourceLabel}] [${directionLabel}] ${comm.senderName}:`);
            lines.push(comm.content);
            lines.push("");
        }

        return lines.join("\n");
    }

    /**
     * Store a communication record
     */
    private async storeCommunication(data: {
        reservationId: number;
        source: string;
        externalId: string;
        content: string;
        direction: string;
        senderName: string;
        senderPhone?: string;
        communicatedAt: Date;
        metadata?: Record<string, any>;
    }): Promise<GuestCommunicationEntity> {
        const comm = this.communicationRepo.create({
            id: uuidv4(),
            reservationId: data.reservationId,
            source: data.source,
            externalId: data.externalId,
            content: data.content,
            direction: data.direction,
            senderName: data.senderName,
            senderPhone: data.senderPhone,
            communicatedAt: data.communicatedAt,
            metadata: data.metadata || {}
        });
        return this.communicationRepo.save(comm);
    }

    /**
     * Normalize phone number to E.164 format
     */
    private normalizePhoneNumber(phone: string): string {
        // Remove non-digit characters
        let cleaned = phone.replace(/\D/g, "");

        // Add + prefix if not present and starts with 1 (US/Canada)
        if (cleaned.length === 10) {
            cleaned = "1" + cleaned;
        }
        if (!cleaned.startsWith("+")) {
            cleaned = "+" + cleaned;
        }
        return cleaned;
    }

    /**
     * Format source for display
     */
    private formatSource(source: string): string {
        switch (source) {
            case "openphone_sms": return "SMS";
            case "openphone_call": return "CALL";
            case "hostify_message": return "MSG";
            default: return source.toUpperCase();
        }
    }
}
