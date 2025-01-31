import { Request, Response } from 'express';
import { ChargeAutomationWebhookService } from '../services/ChargeAutomationWebhookService';

export class ChargeAutomationWebhookController {
    
    async handleWebhook(req: Request, res: Response) {
        const webhookService = new ChargeAutomationWebhookService();
        try {
            const result = await webhookService.processWebhook(req.body);
            return res.status(200).json(result);
        } catch (error) {
            console.error('Webhook processing error:', error);
            return res.status(500).json({ 
                status: 'error',
                message: 'Internal server error'
            });
        }
    }
}