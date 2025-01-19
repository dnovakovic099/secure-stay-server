import { Message } from "../entity/Message";
import { MessagingEmailInfo } from "../entity/MessagingEmail";
import { MessagingPhoneNoInfo } from "../entity/MessagingPhoneNo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import { HostAwayClient } from "../client/HostAwayClient";
import logger from "../utils/logger.utils";

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
            "inquiryTimeout",
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

            //check if conversation has been answered after the guest message
            const isAnswered = await this.checkUnasweredMessages(conversationMessages, msg);
            logger.info(`isAnswered is ${isAnswered} for messageId ${msg.messageId}`);
            if (!isAnswered) {
                //check if the guest message received time has exceeded more than 10 minutes
                logger.info(`Checking if guest message ${msg.messageId} received time has exceeded more than 10 minutes`)
                await this.checkGuestMessageTime(msg);
            }
        }
        return;
    }

    private async checkGuestMessageTime(msg: Message) {
        const nowUtc = new Date(); // Current UTC time
        const receivedAt = msg.receivedAt; // Already in UTC

        // Calculate the difference in milliseconds
        const differenceInMilliseconds = nowUtc.getTime() - receivedAt.getTime();
        logger.info(`Difference in ms is ${differenceInMilliseconds} for messageId ${msg.messageId}`)

        // Check if the difference is greater than 10 minutes
        if (differenceInMilliseconds > 5 * 60 * 1000) {
            logger.info(`Sending email notification for unanswered guest message conversationId: ${msg.conversationId} messageId: ${msg.messageId}`)
            await this.notifyUnansweredMessage(msg.body, msg.reservationId, msg.receivedAt);
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

    private async notifyUnansweredMessage(body: string, reservationId: number, date: Date) {

        const subject = "Action Required: Guest Message Waiting for Your Response";
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
}