import { request } from "http";
import { ConnectedAccountService } from "../services/ConnectedAccountService";
import { NextFunction, Request, Response } from "express";
import { dataSaved } from "../helpers/response";

export class ConnectedAccountController {
    async savePmAccountInfo(request: Request, response: Response, next: NextFunction) {
        try {
            const connectedAccountService = new ConnectedAccountService();
            const { account, clientId, clientSecret } = request.body;

            await connectedAccountService.savePmAccountInfo(account, clientId, clientSecret);

            return response.status(201).json(dataSaved(`${account.toUpperCase()} account info saved successfully`));
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
}