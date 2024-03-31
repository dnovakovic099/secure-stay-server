import { request } from "http";
import { ConnectedAccountService } from "../services/ConnectedAccountService";
import { NextFunction, Request, Response } from "express";
import { dataSaved, successDataFetch } from "../helpers/response";
interface CustomRequest extends Request {
    user?: any;
}
export class ConnectedAccountController {
    async savePmAccountInfo(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();

            const { clientId, clientSecret } = request.body;
            const userId = request.user.id;

            await connectedAccountService.savePmAccountInfo(clientId, clientSecret, userId);

            return response.status(201).json(dataSaved(`PM account info saved successfully`));
        } catch (error) {
            return next(error);
        }
    }

    async saveSeamAccountInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const { apiKey } = request.body;

            await connectedAccountService.saveSeamAccountInfo(apiKey);

            return response.status(201).json(dataSaved(`Seam account info saved successfully`));
        } catch (error) {
            return next(error);
        }
    }

    async saveSifelyAccountInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const { clientId, clientSecret } = request.body;

            await connectedAccountService.saveSifelyAccountInfo(clientId, clientSecret);

            return response.status(201).json(dataSaved(`Sifely account info saved successfully`));
        } catch (error) {
            return next(error);
        }
    }

    async saveStripeAccountInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const { apiKey } = request.body;

            await connectedAccountService.saveStripeAccountInfo(apiKey);

            return response.status(201).json(dataSaved(`Stripe account info saved successfully`));
        } catch (error) {
            return next(error);
        }
    }

    async getConnectedAccountInfo(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const userId = request.user.id;

            const connectedAccountInfo = await connectedAccountService.getConnectedAccountInfo(userId);

            return response.status(200).json(successDataFetch(connectedAccountInfo));
        } catch (error) {
            return next(error);
        }
    };
}