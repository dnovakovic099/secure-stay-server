import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { UpsellPurchasedItem } from "../types/chargeAutomation";
import { sendUpsellOrderEmail } from './UpsellEmailService';

export class ChargeAutomationService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);

    async fetchNewUpsellOrders() {
        try {
            const CA_API_URL = process.env.CHARGE_AUTOMATION_API_URL;
            const CA_API_KEY = process.env.CHARGE_AUTOMATION_API_KEY;

            const response = await fetch(`${CA_API_URL}/upsell-purchased`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${CA_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('CA API Error:', errorData);
                throw new Error(`CA API Error: ${errorData.message}`);
            }

            const responseData = await response.json();

            if (responseData.status !== 'success') {
                console.error('Unexpected API response format:', responseData);
                return [];
            }

            const items: UpsellPurchasedItem[] = Array.isArray(responseData.data) 
                ? responseData.data 
                : [responseData.data];

            const orders = items.map(item => ({
                status: item.client_approval_status || 'Pending',
                listing_id: item.pms_booking_id,
                cost: item.order_details.amount,
                order_date: new Date(item.due_date),
                client_name: item.order_details.user_name,
                property_owner: 'N/A', // It is necessary to determine where to get this field
                type: item.internal_name,
                description: item.note
            }));

            for (const order of orders) {
                const existingOrder = await this.upsellOrderRepo.findOne({
                    where: {
                        listing_id: order.listing_id,
                        order_date: order.order_date
                    }
                });

                if (!existingOrder) {
                    await this.upsellOrderRepo.save(order);
                    await sendUpsellOrderEmail(order);
                }
            }

            return orders;
        } catch (error) {
            console.error('Error fetching from ChargeAutomation:', error);
            return [];
        }
    }
} 