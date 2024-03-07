import { NextFunction, Request, Response } from "express";
import { MessagingService } from "../services/MessagingServices";
import { dataSaved, dataUpdated } from "../helpers/response";

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

            return response.status(200).json(dataUpdated('Email deleted successfully'));
        } catch (error) {
            return next(error);
        }
    }
}