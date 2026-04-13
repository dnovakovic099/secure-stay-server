import { NextFunction, Request, Response } from 'express';
import { RefundRequestSettingsService } from '../services/RefundRequestSettingsService';

export class RefundRequestSettingsController {
    private service = new RefundRequestSettingsService();

    getSettings = async (request: Request, response: Response, next: NextFunction) => {
        try {
            const settings = await this.service.getSettings();
            return response.status(200).json({ status: true, data: settings });
        } catch (error) {
            return next(error);
        }
    };

    updateSettings = async (request: Request, response: Response, next: NextFunction) => {
        try {
            const { slackTagIds } = request.body;
            const userId = (request as any).user?.id;
            const updated = await this.service.upsertSettings(slackTagIds ?? '[]', userId);
            return response.status(200).json({ status: true, data: updated });
        } catch (error) {
            return next(error);
        }
    };
}
