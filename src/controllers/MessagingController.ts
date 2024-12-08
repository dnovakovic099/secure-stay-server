import { NextFunction, Request, Response } from "express";
import { MessagingService } from "../services/MessagingServices";
import { dataDeleted, dataNotFound, dataSaved, dataUpdated, successDataFetch } from "../helpers/response";
import sendEmail from "../utils/sendEmai";

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
}