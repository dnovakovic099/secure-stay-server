import { NextFunction, Request, Response } from "express";
import { MessagingService } from "../services/MessagingServices";
import { dataDeleted, dataSaved, dataUpdated } from "../helpers/response";

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
}