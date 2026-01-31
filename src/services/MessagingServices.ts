import { Message } from "../entity/Message";
import { MessagingEmailInfo } from "../entity/MessagingEmail";
import { MessagingPhoneNoInfo } from "../entity/MessagingPhoneNo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import { HostAwayClient } from "../client/HostAwayClient";
import { Hostify } from "../client/Hostify";
import logger from "../utils/logger.utils";
import { isEmojiOrThankYouMessage, isReactionMessage } from "../helpers/helpers";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import sendSlackMessage from "../utils/sendSlackMsg";
import { buildUnansweredMessageAlert } from "../utils/slackMessageBuilder";

// Hostify message webhook payload interface
export interface HostifyMessagePayload {
    thread_id: string;
    message_id: number;
    message: string;
    guest_id: string;
    guest_name: string;
    created: string;
    sent_by: string | null;
    is_automatic: number;
    is_sms: boolean;
    is_incoming: number;
    reservation_id: string;
    attachment_url: string | null;
    type: string;
    listing_id: string;
    action: string;
}

interface MessageType {
    id: number;
    conversationId: number;
    reservationId: number;
    body: string;
    isIncoming: number;
    date: Date;
}

interface MessageObj {
    id: number;
    conversationId: number;
    reservationId: number;
    isIncoming: number;
    date: string;
}

export class MessagingService {
    private messagingEmailInfoRepository = appDatabase.getRepository(MessagingEmailInfo);
    private messagingPhoneNoInfoRepository = appDatabase.getRepository(MessagingPhoneNoInfo);
    private messageRepository = appDatabase.getRepository(Message);
    private hostawayClient = new HostAwayClient();
    private hostifyClient = new Hostify();

    async saveEmailInfo(email: string) {
        const isExist = await this.messagingEmailInfoRepository.findOne({ where: { email } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Email already exists');
        }

        const emailInfo = new MessagingEmailInfo();
        emailInfo.email = email;
        emailInfo.created_at = new Date();
        emailInfo.updated_at = new Date();

        return await this.messagingEmailInfoRepository.save(emailInfo);
    }

    async deleteEmailInfo(id: number) {
        return await this.messagingEmailInfoRepository.delete({ id });
    }

    async getEmailList() {
        const emails = await this.messagingEmailInfoRepository.find({ select: ['id', 'email'] });
        return emails;
    }

    async savePhoneNoInfo(countryCode: string, phoneNo: string, supportsSMS: boolean, supportsCalling: boolean, supportsWhatsApp: boolean) {
        const isExist = await this.messagingPhoneNoInfoRepository.findOne({ where: { phone: phoneNo } });
        if (isExist) {
            throw CustomErrorHandler.alreadyExists('Phone already exists');
        }

        const phoneNoInfo = new MessagingPhoneNoInfo();
        phoneNoInfo.country_code = countryCode;
        phoneNoInfo.phone = phoneNo;
        phoneNoInfo.supportsSMS = supportsSMS;
        phoneNoInfo.supportsCalling = supportsCalling;
        phoneNoInfo.supportsWhatsApp = supportsWhatsApp;
        phoneNoInfo.created_at = new Date();
        phoneNoInfo.updated_at = new Date();

        return await this.messagingPhoneNoInfoRepository.save(phoneNoInfo);
    }

    async deletePhoneNoInfo(id: number) {
        return await this.messagingPhoneNoInfoRepository.delete({ id });
    }

    async updatePhoneNoInfo(id: number, countryCode: string, phoneNo: string, supportsSMS: boolean, supportsCalling: boolean, supportsWhatsApp: boolean) {
        const phoneNoInfo = await this.messagingPhoneNoInfoRepository.findOne({ where: { id } });
        if (!phoneNoInfo) {
            throw CustomErrorHandler.notFound('Phone number not found');
        }

        phoneNoInfo.country_code = countryCode;
        phoneNoInfo.phone = phoneNo;
        phoneNoInfo.supportsSMS = supportsSMS;
        phoneNoInfo.supportsCalling = supportsCalling;
        phoneNoInfo.supportsWhatsApp = supportsWhatsApp;
        phoneNoInfo.updated_at = new Date();

        return await this.messagingPhoneNoInfoRepository.save(phoneNoInfo);
    }

    async getPhoneNoList() {
        const phoneNoList = await this.messagingPhoneNoInfoRepository.find({ select: ['id', 'country_code', 'phone', 'supportsSMS', 'supportsCalling', 'supportsWhatsApp'] });
        return phoneNoList;
    }

    async handleConversation(message: MessageType) {
        logger.info(`New message received from webhook: ${JSON.stringify(message)}`)
        const inquiryStatuses = [
            "pending",
            "awaitingPayment",
            "inquiry",
            "inquiryPreapproved",
            "inquiryDenied",
            "inquiryTimedout",
            "inquiryNotPossible"
        ];
        const reservationInfo = await this.hostawayClient.getReservation(
            message.reservationId,
            process.env.HOSTAWAY_CLIENT_ID,
            process.env.HOSTAWAY_CLIENT_SECRET
        );
        if (!inquiryStatuses.includes(reservationInfo.status)) {
            logger.info(`Message ${message.id} received from webhook does not comply with reservation(${reservationInfo?.status}) inquiry status`);
            logger.info(`Skipping database save for the conversationId: ${message.conversationId} messageId:${message.id} `);
            return;
        };

        // save the message in the database only if isIncoming is 1; 
        if (message.isIncoming && message.isIncoming == 1) {
            await this.saveIncomingGuestMessage(message);
            logger.info(`Guest message saved successfully messageId: ${message.id} conversationId: ${message.conversationId}`);
        }
        return;
    }

    async getUnansweredMessages(page: number, limit: number, answered: boolean) {
        const [messages, total] = await this.messageRepository
            .createQueryBuilder('message')
            .leftJoinAndMapOne(
                'message.reservation',
                ReservationInfoEntity,
                'reservation',
                'message.reservationId = reservation.id'
            )
            .where('message.answered = :answered', { answered })
            .orderBy('message.createdAt', 'DESC')
            .skip((page - 1) * limit)
            .take(limit)
            .getManyAndCount();

        return {
            data: messages.map(msg => {
                const mappedMsg = {
                    ...msg,
                    guestName: msg.guestName || msg['reservation']?.guestName || null,
                    conversationId: msg.source === 'hostify' ? msg.threadId : msg.conversationId,
                };
                return mappedMsg;
            }),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }


    async updateMessageStatus(messageId: number, answered: boolean) {
        const message = await this.messageRepository.findOne({ where: { id: messageId } });
        if (!message) {
            throw CustomErrorHandler.notFound('Message not found');
        }
        message.answered = answered;
        return await this.messageRepository.save(message);
    }

    private async saveIncomingGuestMessage(message: MessageType) {
        const newMessage = new Message();
        newMessage.messageId = message.id;
        newMessage.conversationId = message.conversationId;
        newMessage.reservationId = message.reservationId;
        newMessage.body = message.body;
        newMessage.isIncoming = message.isIncoming;
        newMessage.receivedAt = message.date;
        newMessage.answered = false;

        return await this.messageRepository.save(newMessage);
    }

    private async fetchGuestMessages() {
        const messages = await this.messageRepository.find({
            where: {
                answered: false,
            },
        });

        return messages;
    }

    public async processUnanweredMessages() {
        const unansweredMessages = await this.fetchGuestMessages();
        if (unansweredMessages.length == 0) {
            logger.info('No unanswered messages found');
            return;
        }

        for (const msg of unansweredMessages) {
            logger.info(`Checking whether answered or not for messageId ${msg.messageId}`)
            //fetch the conversation messages from hostaway
            const conversationMessages = await this.hostawayClient.fetchConversationMessages(
                msg.conversationId,
                process.env.HOSTAWAY_CLIENT_ID,
                process.env.HOSTAWAY_CLIENT_SECRET
            );

            if (!conversationMessages) {
                logger.info(`Unable to fetch conversation messages from Hostaway for ${msg.messageId}`);
                return;
            }
            //check if conversation has been answered after the guest message
            const isAnswered = await this.checkUnasweredMessages(conversationMessages, msg);
            logger.info(`isAnswered is ${isAnswered} for messageId ${msg.messageId}`);
            if (!isAnswered) {
                const isReactionMsg = isReactionMessage(msg.body);
                const isEmojiOrThankYouMsg= isEmojiOrThankYouMessage(msg.body);
                if (isReactionMsg || isEmojiOrThankYouMsg) {
                    await this.updateMessageAsAnswered(msg);
                } else {
                    const isValidInquiryMessage = await this.checkValidInquiryReservation(msg);
                    if (isValidInquiryMessage) {
                        logger.info(`Checking if guest message ${msg.messageId} received time has exceeded more than 5 minutes`);
                        await this.checkGuestMessageTime(msg);
                    } else {
                        await this.updateMessageAsAnswered(msg);
                    }
                }
            }
        }
        return;
    }

    private async checkValidInquiryReservation(msg: Message) {
        //check if inquiry message thread is moved to booked message thread
        const reservation = await this.hostawayClient.getReservation(
            msg.reservationId,
            process.env.HOST_AWAY_CLIENT_ID,
            process.env.HOST_AWAY_CLIENT_SECRET
        );
        const inquiryStatuses = [
            "pending",
            "awaitingPayment",
            "inquiry",
            "inquiryPreapproved",
            "inquiryDenied",
            "inquiryTimedout",
            "inquiryNotPossible",
            "preapproved",
            "timedout",
            "not_possible"
        ];
        if (!reservation) {
            return false;
        }
        return inquiryStatuses.includes(reservation?.status);
    }

    private async checkGuestMessageTime(msg: Message) {
        const nowUtc = new Date(); // Current UTC time
        const receivedAt = msg.receivedAt; // Already in UTC

        // Calculate the difference in milliseconds
        const differenceInMilliseconds = nowUtc.getTime() - receivedAt.getTime();
        logger.info(`Difference in ms is ${differenceInMilliseconds} for messageId ${msg.messageId}`)

        // Check if the difference is greater than 5 minutes
        if (differenceInMilliseconds > 5 * 60 * 1000) {
            logger.info(`Sending Slack notification for unanswered guest message conversationId: ${msg.conversationId || msg.threadId} messageId: ${msg.messageId}`);
            await this.notifyUnansweredMessageSlack(msg);
        }
    }


    private async checkUnasweredMessages(conversationMessages: MessageObj[], guestMessage: Message): Promise<Boolean> {
        for (const msg of conversationMessages) {
            const currentMessageDate = new Date(msg.date);
            if (msg.isIncoming == 0 && (currentMessageDate.getTime() > guestMessage.receivedAt.getTime())) {
                await this.updateMessageAsAnswered(guestMessage);
                logger.info(`Updated messageId ${guestMessage.messageId} as answered`);
                return true;
            }
        }
        return false;
    }

    private async updateMessageAsAnswered(guestMessage: Message) {
        const message = await this.messageRepository.findOne({ where: { id: guestMessage.id } });
        if (!message) {
            logger.info(`Could not find message with messageId:${guestMessage.messageId}`);
            return;
        }

        message.answered = true;
        return await this.messageRepository.save(message);
    };

    private async notifyUnansweredMessage(body: string, reservationId: number, date: Date, currentTimeStamp: number) {

        const subject = `Action Required: Guest Message Waiting for Your Response-${currentTimeStamp}`;
        const html = `
               <html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
      <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
        Notification: Unaddressed Guest Message
      </h2>
      <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
        A guest has sent a message that requires your attention. Please review the details below:
      </p>
      <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
        <p style="font-size: 18px; color: #333; margin: 0;">
          <strong>Message:</strong>
        </p>
        <p style="font-size: 20px; color: #000; margin: 10px 0; font-weight: bold;">
          ${body}
        </p>
      </div>
      <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Reservation ID:</strong> ${reservationId}
      </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
        <strong>Received at:</strong> ${date}
      </p>
    </div>
  </body>
</html>

        `;

        await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);
    }

    /**
     * Send Slack notification for unanswered guest message
     */
    private async notifyUnansweredMessageSlack(msg: Message) {
        try {
            const slackMessage = buildUnansweredMessageAlert(
                msg.body,
                msg.reservationId,
                msg.receivedAt,
                msg.guestName || undefined,
                msg.listingId || undefined
            );
            await sendSlackMessage(slackMessage);
            logger.info(`[Slack] Unanswered message notification sent for messageId: ${msg.messageId}`);
        } catch (error) {
            logger.error(`[Slack] Error sending unanswered message notification: ${error.message}`);
        }
    }

    // ==================== HOSTIFY-SPECIFIC METHODS ====================

    /**
     * Save an incoming guest message from Hostify webhook
     * Only saves messages where is_incoming === 1
     */
    async saveHostifyGuestMessage(payload: HostifyMessagePayload) {
        try {
            // Check if message already exists
            const existingMessage = await this.messageRepository.findOne({
                where: { messageId: payload.message_id }
            });

            if (existingMessage) {
                logger.info(`[Hostify] Message ${payload.message_id} already exists, skipping save`);
                return existingMessage;
            }

            const newMessage = new Message();
            newMessage.messageId = payload.message_id;
            newMessage.reservationId = Number(payload.reservation_id);
            newMessage.body = payload.message;
            newMessage.isIncoming = payload.is_incoming;
            newMessage.receivedAt = new Date(payload.created);
            newMessage.answered = false;

            // Hostify-specific fields
            newMessage.threadId = payload.thread_id;
            newMessage.listingId = payload.listing_id;
            newMessage.guestId = payload.guest_id;
            newMessage.guestName = payload.guest_name || null;
            newMessage.source = 'hostify';

            const savedMessage = await this.messageRepository.save(newMessage);
            logger.info(`[Hostify] Guest message saved successfully - messageId: ${payload.message_id}, threadId: ${payload.thread_id}`);
            return savedMessage;
        } catch (error) {
            logger.error(`[Hostify] Error saving guest message: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process unanswered messages using Hostify APIs
     * Fetches unanswered Hostify messages and checks if they've been responded to
     */
    public async processUnansweredMessagesHostify() {
        const unansweredMessages = await this.messageRepository.find({
            where: {
                answered: false,
                source: 'hostify'
            },
        });

        if (unansweredMessages.length === 0) {
            logger.info('[Hostify] No unanswered messages found');
            return;
        }

        logger.info(`[Hostify] Processing ${unansweredMessages.length} unanswered messages`);

        for (const msg of unansweredMessages) {
            try {
                logger.info(`[Hostify] Checking message ${msg.messageId} in thread ${msg.threadId}`);

                // Check if message has been answered via Hostify inbox
                const isAnswered = await this.checkHostifyMessageAnswered(msg);
                logger.info(`[Hostify] Message ${msg.messageId} isAnswered: ${isAnswered}`);

                if (!isAnswered) {
                    // Check for emoji/thank you messages (auto-mark as answered)
                    const isReactionMsg = isReactionMessage(msg.body);
                    const isEmojiOrThankYouMsg = isEmojiOrThankYouMessage(msg.body);

                    if (isReactionMsg || isEmojiOrThankYouMsg) {
                        logger.info(`[Hostify] Message ${msg.messageId} is reaction/thank you, marking as answered`);
                        await this.updateMessageAsAnswered(msg);
                    } else {
                        // Check if message has exceeded 5 minute threshold
                        await this.checkGuestMessageTime(msg);
                    }
                }
            } catch (error) {
                logger.error(`[Hostify] Error processing message ${msg.messageId}: ${error.message}`);
            }
        }
    }

    /**
     * Check if a Hostify message has been answered by fetching the inbox thread
     * Returns true if there's an outgoing message after the guest message
     */
    private async checkHostifyMessageAnswered(guestMessage: Message): Promise<boolean> {
        if (!guestMessage.threadId) {
            logger.warn(`[Hostify] No threadId for message ${guestMessage.messageId}`);
            return false;
        }

        const apiKey = process.env.HOSTIFY_API_KEY;
        if (!apiKey) {
            logger.error('[Hostify] HOSTIFY_API_KEY not configured');
            return false;
        }

        try {
            const inboxThread = await this.hostifyClient.getInboxThread(apiKey, guestMessage.threadId);

            if (!inboxThread || !inboxThread.messages || inboxThread.messages.length === 0) {
                logger.info(`[Hostify] No messages found in thread ${guestMessage.threadId}`);
                return false;
            }

            // Check if there's any host/representative message after the guest message
            const guestMessageTime = guestMessage.receivedAt.getTime();

            for (const msg of inboxThread.messages) {
                const messageTime = new Date(msg.created).getTime();
                // Check if this is an outgoing message (host/representative) sent after the guest message
                if (msg.senderType !== 'guest' && messageTime > guestMessageTime) {
                    logger.info(`[Hostify] Found reply message ${msg.id} after guest message ${guestMessage.messageId}`);
                    await this.updateMessageAsAnswered(guestMessage);
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error(`[Hostify] Error checking thread ${guestMessage.threadId}: ${error.message}`);
            return false;
        }
    }
}