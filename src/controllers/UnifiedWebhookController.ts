import { NextFunction, Request, Response } from "express";
import logger from "../utils/logger.utils";

export class UnifiedWebhookController {

    async handleWebhookResponse(request: Request, response: Response, next: NextFunction) {
        try {
            const body = request.body;
            logger.info(`Received unified - webhook response: ${JSON.stringify(body)}`);
            response.status(200).send("Ok");
        } catch (error) {
            logger.error(`Error handling webhook response: ${error.message}`);
            return next(error);
        }
    }
}