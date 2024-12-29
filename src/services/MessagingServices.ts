import { Message } from "../entity/Message";
import { MessagingEmailInfo } from "../entity/MessagingEmail";
import { MessagingPhoneNoInfo } from "../entity/MessagingPhoneNo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";

interface MessageType {
    id: number;
    conversationId: number;
    reservationId: number;
    body: string;
    isIncoming: number;
    date: Date;
}

export class MessagingService {
    private messagingEmailInfoRepository = appDatabase.getRepository(MessagingEmailInfo);
    private messagingPhoneNoInfoRepository = appDatabase.getRepository(MessagingPhoneNoInfo);
    private messageRepository = appDatabase.getRepository(Message);

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
        // save the message in the database only if isIncoming is 1; 
        if (message.isIncoming && message.isIncoming == 1) {
            const incomingMessage = await this.handleIncomingMessage(message);
            await this.trackUnansweredMessage(incomingMessage.id, message.body, message.reservationId, message.date);
        } else {
            // handle the agent reply messages
            const guestMessage = await this.messageRepository.find({
                where: { conversationId: message.conversationId },
                order: { receivedAt: 'DESC' },
                take: 1,
            });

            if (guestMessage.length > 0) {
                guestMessage[0].answered = true;
                guestMessage[0].lastUpdated = new Date();
                await this.messageRepository.save(guestMessage[0]);
            }
        }
        return;
    }

    private async handleIncomingMessage(message: MessageType) {
        const newMessage = new Message();
        newMessage.conversationId = message.conversationId;
        newMessage.reservationId = message.reservationId;
        newMessage.body = message.body;
        newMessage.isIncoming = message.isIncoming;
        newMessage.receivedAt = message.date;
        newMessage.answered = false;
        newMessage.lastUpdated = new Date();

        return await this.messageRepository.save(newMessage);
    }

    private async trackUnansweredMessage(messageId: number, body: string, reservationId: number, date: Date) {
        setTimeout(async () => {
            const message = await this.messageRepository.findOne({ where: { id: messageId } });
            if (message && !message.answered) {
                this.notifyUnansweredMessage(body, reservationId, date);
            }
        }, 2 * 60 * 1000); // Check after 15 minutes
    }

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