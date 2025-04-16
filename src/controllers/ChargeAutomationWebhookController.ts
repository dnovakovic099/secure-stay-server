import { Request, Response } from 'express';
import { ChargeAutomationWebhookService } from '../services/ChargeAutomationWebhookService';
import logger from '../utils/logger.utils';

export class ChargeAutomationWebhookController {
    
    async handleWebhook(req: Request, res: Response) {
        const webhookService = new ChargeAutomationWebhookService();
        try {
            logger.error('[ChargeAutomationWebhookController][handleWebhook] Data received from webhook:', JSON.stringify(req.body));
            const result = await webhookService.processWebhook(req.body);
            return res.status(200).json(result);
        } catch (error) {
            logger.error('[ChargeAutomationWebhookController][handleWebhook] Webhook processing error:', error);
            return res.status(500).json({ 
                status: 'error',
                message: 'Internal server error'
            });
        }
    }
}