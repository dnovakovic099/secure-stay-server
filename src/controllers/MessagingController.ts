import { NextFunction, Request, Response } from "express";
import { MessagingService } from "../services/MessagingServices";
import { dataDeleted, dataNotFound, dataSaved, dataUpdated, successDataFetch } from "../helpers/response";
import sendEmail from "../utils/sendEmai";
import { OpenPhoneService } from '../services/OpenPhoneService';

interface CustomRequest extends Request {
    user?: any;
}


export class MessagingController {
    async saveEmailInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const { email } = request.body;
            await messagingService.saveEmailInfo(email);

            return response.status(201).json(dataSaved('Email info saved successfully'));
        } catch (error) {
            return next(error);
        }
    };

    async deleteEmailInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const { id } = request.params;
            await messagingService.deleteEmailInfo(Number(id));

            return response.status(200).json(dataDeleted('Email deleted successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async getEmailList(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const emails = await messagingService.getEmailList();
            if (emails.length == 0) {
                return response.status(200).json(dataNotFound('Emails not found'));
            }

            return response.status(200).json(successDataFetch(emails));
        } catch (error) {
            return next(error);
        }
    }

    async savePhoneNoInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const { countryCode, phoneNo, supportsSMS, supportsCalling, supportsWhatsApp } = request.body;
            await messagingService.savePhoneNoInfo(countryCode, phoneNo, supportsSMS, supportsCalling, supportsWhatsApp);

            return response.status(201).json(dataSaved('Phone number saved successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async deletePhoneNoInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const { id } = request.params;
            await messagingService.deletePhoneNoInfo(Number(id));

            return response.status(200).json(dataUpdated('Phone number deleted successfully'));
        } catch (error) {
            return next(error);
        }
    };

    async updatePhoneNoInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const { id, countryCode, phoneNo, supportsSMS, supportsCalling, supportsWhatsApp } = request.body;
            await messagingService.updatePhoneNoInfo(id, countryCode, phoneNo, supportsSMS, supportsCalling, supportsWhatsApp);

            return response.status(201).json(dataDeleted('Phone number info updated successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async getPhoneNoList(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            const phoneNos = await messagingService.getPhoneNoList();
            if (phoneNos.length == 0) {
                return response.status(200).json(dataNotFound('Phone numbers not found'));
            }

            return response.status(200).json(successDataFetch(phoneNos));
        } catch (error) {
            return next(error);
        }
    }

    async sendSupportMessage(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const { message } = request.body;
            const { name, email } = request.user;

            const subject = `New message from ${name}`;
            const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">New message</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Message:</strong> ${message}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Sent By:</strong> ${name} (${email})
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

            await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);

            return response.status(200).json(dataSaved('Support message sent successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async getUnansweredMessages(request: Request, response: Response, next: NextFunction) {
        try {
            const page = parseInt(request.query.page as string) || 1;
            const limit = parseInt(request.query.limit as string) || 10;
            const answered = request.query.answered === 'true';
            const messagesService = new MessagingService();
            const messages = await messagesService.getUnansweredMessages(page, limit, answered);
            return response.send({
                status: true,
                ...messages
            });
        } catch (error) {
            return next(error);
        }
    }

    async updateMessageStatus(request: Request, response: Response, next: NextFunction) {
        try {
            const { id } = request.params;
            const { answered } = request.body;
            const messagesService = new MessagingService();
            await messagesService.updateMessageStatus(Number(id), answered);
            return response.status(200).json(dataUpdated('Message status updated successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async handleConversation(request: Request, response: Response, next: NextFunction) {
        try {
            const messagingService = new MessagingService();

            await messagingService.handleConversation(request.body);

            return response.status(200).json(dataSaved('Conversation handled successfully'));
        } catch (error) {
            return next(error);
        }
    }

    async listHostifyThreads(request: Request, response: Response, next: NextFunction) {
        try {
            const page = parseInt(request.query.page as string) || 1;
            const per_page = parseInt(request.query.per_page as string) || 20;
            const messagingService = new MessagingService();
            const result = await messagingService.listHostifyThreads(page, per_page);
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async getHostifyThread(request: Request, response: Response, next: NextFunction) {
        try {
            const { threadId } = request.params;
            const messagingService = new MessagingService();
            const thread = await messagingService.getHostifyThread(threadId);
            return response.status(200).json({ status: true, data: thread });
        } catch (error) {
            return next(error);
        }
    }

    async postHostifyReply(request: Request, response: Response, next: NextFunction) {
        try {
            const { threadId } = request.params;
            const { message } = request.body;
            if (!message?.trim()) {
                return response.status(400).json({ status: false, message: 'Message is required' });
            }
            const messagingService = new MessagingService();
            const result = await messagingService.postHostifyReply(threadId, message.trim());
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async listOpenPhoneConversations(request: Request, response: Response, next: NextFunction) {
        try {
            const maxResults = parseInt(request.query.maxResults as string) || 20;
            const pageToken = request.query.pageToken as string | undefined;
            const participants = ([] as string[]).concat((request.query.participants as any) || []);
            const openPhoneService = new OpenPhoneService();
            const result = await openPhoneService.listInboxConversations(
                maxResults,
                pageToken,
                participants.length ? participants : undefined,
            );
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async getOpenPhoneMessages(request: Request, response: Response, next: NextFunction) {
        try {
            const { conversationId } = request.params;
            const phoneNumberId = request.query.phoneNumberId as string;
            const participants = ([] as string[]).concat(request.query.participants as any || []);
            if (!phoneNumberId || !participants.length) {
                return response.status(400).json({ status: false, message: 'phoneNumberId and participants are required' });
            }
            const openPhoneService = new OpenPhoneService();
            const result = await openPhoneService.getConversationMessages(conversationId, phoneNumberId, participants);
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async sendOpenPhoneReply(request: Request, response: Response, next: NextFunction) {
        try {
            const { conversationId } = request.params;
            const { phoneNumberId, participants, content } = request.body;
            if (!content?.trim() || !phoneNumberId || !participants?.length) {
                return response.status(400).json({ status: false, message: 'phoneNumberId, participants and content are required' });
            }
            const openPhoneService = new OpenPhoneService();
            const result = await openPhoneService.sendConversationReply(phoneNumberId, participants, content.trim());
            return response.status(200).json({ status: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    async findOpenPhoneMessagesByParticipant(request: Request, response: Response, next: NextFunction) {
        try {
            const phone = request.query.phone as string;
            if (!phone) {
                return response.status(400).json({ status: false, message: 'phone query param is required' });
            }
            const openPhoneService = new OpenPhoneService();
            const result = await openPhoneService.findMessagesByParticipant(phone);
            return response.status(200).json({ status: true, data: result });
        } catch (error: any) {
            const opDetail = error.response?.data;
            if (opDetail) {
                return response.status(500).json({ status: false, message: 'OpenPhone API error', detail: opDetail });
            }
            return next(error);
        }
    }

    async getGuestReservationDetails(request: Request, response: Response, next: NextFunction) {
        try {
            const { reservationId } = request.params;
            const messagingService = new MessagingService();
            const details = await messagingService.getGuestReservationDetails(Number(reservationId));
            return response.status(200).json({ status: true, data: details });
        } catch (error) {
            return next(error);
        }
    }

}