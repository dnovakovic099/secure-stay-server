import { Request, Response } from 'express';
import { ZapierWebhookService } from '../services/ZapierWebhookService';
import logger from '../utils/logger.utils';

export class ZapierWebhookController {
    async handleWebhook(req: Request, res: Response) {
        const webhookService = new ZapierWebhookService();
        try {
            logger.info('[ZapierWebhookController][handleWebhook] Incoming request body:', JSON.stringify(req.body));
            const result = await webhookService.processWebhook(req.body);
            return res.status(200).json(result);
        } catch (error) {
            logger.error('[ZapierWebhookController][handleWebhook] Error:', error);
            return res.status(500).json({ 
                status: 'error',
                message: 'Internal server error'
            });
        }
    }
}
