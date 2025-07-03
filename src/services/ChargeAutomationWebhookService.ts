import { Repository } from 'typeorm';
import { Between } from 'typeorm';
import { UpsellOrder } from '../entity/UpsellOrder';
import { HostAwayClient } from '../client/HostAwayClient';
import { appDatabase } from "../utils/database.util";
import { ownerDetails } from '../constant';
import logger from '../utils/logger.utils';

interface WebhookData {
    event: string;
    data: Array<{
        pms_booking_id: string;
        client_approval_status: number;
        order_details: {
            amount: number;
            user_name: string;
        };
        due_date: string;
        title: string;
        internal_name: string;
        note: string;
        meta: {
            description: string;
        };
    }>;
}

export class ChargeAutomationWebhookService {
    private upsellOrderRepo: Repository<UpsellOrder>;

    constructor() {
        this.upsellOrderRepo = appDatabase.getRepository(UpsellOrder);
    }

    async processWebhook(webhookData: WebhookData): Promise<{ status: string; message: string }> {
        logger.info(`[ChargeAutomationWebhookService][processWebhook] webhook data received`, JSON.stringify(webhookData));
        if (webhookData.event !== 'booking.upsell.purchased') {
            logger.info(`[ChargeAutomationWebhookService][processWebhook] Skipping webhook with event type: ${webhookData.event}`);
            return {
                status: 'skipped',
                message: 'Not a booking.upsell.purchased event'
            };
        }

        let processedCount = 0;
        let skippedCount = 0;

        logger.info(`[ChargeAutomationWebhookService][processWebhook] processing webhook data`);

        for (const item of webhookData.data) {
            try {
                const hostawayClient = new HostAwayClient();
                const orderDate = new Date(item.due_date);

                const reservationInfo = await hostawayClient.getReservation(
                    Number(item.pms_booking_id),
                    process.env.HOST_AWAY_CLIENT_ID,
                    process.env.HOST_AWAY_CLIENT_SECRET
                );

                const order = {
                    status: item.client_approval_status === 1 ? 'Approved' : 'Denied',
                    listing_id: reservationInfo.listingMapId,
                    listing_name: reservationInfo.listingName,
                    cost: item.order_details.amount,
                    order_date: orderDate,
                    client_name: reservationInfo.guestName,
                    property_owner: ownerDetails[reservationInfo.listingMapId]?.name || " ",
                    type: item.title,
                    description: '',
                    booking_id: item.pms_booking_id,
                    arrival_date: reservationInfo.arrivalDate,
                    departure_date: reservationInfo.departureDate,
                    phone: reservationInfo.phone || 'N/A'
                };

                await this.upsellOrderRepo.save(order);
                logger.info(`[ChargeAutomationWebhookService][processWebhook] Upsell order for reservation ${item.pms_booking_id} saved successfully`);
            } catch (error) {
                logger.error(`[ChargeAutomationWebhookService][processWebhook] Error processing order for ${item.pms_booking_id}:`, error);
            }
        }

        return {
            status: 'success',
            message: `Processed ${processedCount} orders, skipped ${skippedCount} duplicates`
        };
    }
}