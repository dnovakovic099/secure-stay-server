import { Repository } from 'typeorm';
import { Between } from 'typeorm';
import { UpsellOrder } from '../entity/UpsellOrder';
import { HostAwayClient } from '../client/HostAwayClient';
import { appDatabase } from "../utils/database.util";
import { ownerDetails } from '../constant';

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
        if (webhookData.event !== 'booking.upsell.purchased') {
            console.log(`Skipping webhook with event type: ${webhookData.event}`);
            return {
                status: 'skipped',
                message: 'Not a booking.upsell.purchased event'
            };
        }

        let processedCount = 0;
        let skippedCount = 0;

        for (const item of webhookData.data) {
            try {
                const hostawayClient = new HostAwayClient();
                const orderDate = new Date(item.due_date);

                const reservationInfo = await hostawayClient.getReservation(
                    Number(item.pms_booking_id),
                    process.env.HOST_AWAY_CLIENT_ID,
                    process.env.HOST_AWAY_CLIENT_SECRET
                );

                const startOfDay = new Date(orderDate.setHours(0, 0, 0, 0));
                const endOfDay = new Date(orderDate.setHours(23, 59, 59, 999));

                const existingOrder = await this.upsellOrderRepo.findOne({
                    where: {
                        listing_id: reservationInfo.listingMapId,
                        order_date: Between(startOfDay, endOfDay)
                    }
                });

                if (existingOrder) {
                  console.log(`Skipping duplicate order for listing ${reservationInfo.listingMapId}`);
                  skippedCount++;
                  continue;
                }

                const order = {
                    status: item.client_approval_status === 1 ? 'Approved' : 'Pending',
                    listing_id: reservationInfo.listingMapId,
                    cost: item.order_details.amount,
                    order_date: orderDate,
                    client_name: reservationInfo.guestName,
                    property_owner: ownerDetails[reservationInfo.listingMapId].name,
                    type: item.title,
                    description: '',
                    booking_id: item.pms_booking_id,
                    arrival_date: new Date(reservationInfo.arrivalDate),
                    departure_date: new Date(reservationInfo.departureDate),
                    phone: reservationInfo.phone || 'N/A'
                };

                await this.upsellOrderRepo.save(order);

            } catch (error) {
                console.error(`Error processing order for ${item.pms_booking_id}:`, error);
            }
        }

        return {
            status: 'success',
            message: `Processed ${processedCount} orders, skipped ${skippedCount} duplicates`
        };
    }
}