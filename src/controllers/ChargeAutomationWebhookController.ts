import { Request, Response } from 'express';
import { UpsellOrder } from "../entity/UpsellOrder";
import { appDatabase } from "../utils/database.util";
import { sendUpsellOrderEmail } from '../services/UpsellEmailService';
import { Between } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class ChargeAutomationWebhookController {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);

    async handleWebhook(req: Request, res: Response) {
        try {
            const webhookData = req.body;

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(__dirname, '../../logs', `webhook-${timestamp}.json`);

            const logData = {
                timestamp: timestamp,
                data: req.body,
                headers: req.headers
            };

            fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

            // const webhookSecret = req.headers['x-ca-signature'];
            // if (webhookSecret !== process.env.CHARGE_AUTOMATION_WEBHOOK_SECRET) {
            //     return res.status(401).json({ error: 'Invalid webhook signature' });
            // }

            // const items = Array.isArray(webhookData) 
            //     ? webhookData
            //     : [webhookData];

            // const orders = items.map(item => ({
            //     status: item.client_approval_status || 'Pending',
            //     listing_id: item.pms_booking_id,
            //     cost: item.order_details.amount,
            //     order_date: new Date(item.due_date),
            //     client_name: item.order_details.user_name,
            //     property_owner: 'N/A', // It is necessary to determine where to get this field
            //     type: item.internal_name,
            //     description: item.note
            // }));

            // for (const order of orders) {
            //     const orderDate = new Date(order.order_date);
            //     const startOfDay = new Date(orderDate.setHours(0, 0, 0, 0));
            //     const endOfDay = new Date(orderDate.setHours(23, 59, 59, 999));

            //     const existingOrder = await this.upsellOrderRepo.findOne({
            //         where: {
            //             listing_id: order.listing_id,
            //             order_date: Between(startOfDay, endOfDay)
            //         }
            //     });

            //     if (!existingOrder) {
            //         await this.upsellOrderRepo.save(order);
            //         await sendUpsellOrderEmail(order);
            //     }
            // }

            return res.status(200).json({ status: 'success' });
        } catch (error) {
            console.error('Webhook processing error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
} 