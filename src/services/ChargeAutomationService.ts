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

            const orders = items.map(item => {
                const status = String(item.client_approval_status || 'Pending').trim();
                const requestedDate = item.due_date ? new Date(item.due_date) : null;
                const isPaid = status === 'Paid';

                return {
                    status,
                    listing_id: item.pms_booking_id,
                    cost: item.order_details.amount,
                    order_date: isPaid ? requestedDate : null,
                    requested_date: requestedDate,
                    client_name: item.order_details.user_name,
                    property_owner: 'N/A', // It is necessary to determine where to get this field
                    type: item.internal_name,
                    description: item.note
                };
            });

            for (const order of orders) {
                const lookupDate = order.requested_date || order.order_date;
                const validLookupDate = lookupDate instanceof Date && !Number.isNaN(lookupDate.getTime());

                const existingOrder = validLookupDate
                    ? await this.findExistingAutomationOrderForDate(order, lookupDate)
                    : await this.upsellOrderRepo.findOne({
                        where: {
                            listing_id: order.listing_id,
                            type: order.type,
                            client_name: order.client_name
                        }
                    });

                if (!existingOrder) {
                    const { requested_date, ...orderToSave } = order;
                    const savedOrder = await this.upsellOrderRepo.save(orderToSave);
                    await this.setRequestedDateIfSupported(savedOrder.id, requested_date);
                    await sendUpsellOrderEmail(savedOrder);
                }
            }

            return orders;
        } catch (error) {
            console.error('Error fetching from ChargeAutomation:', error);
            return [];
        }
    }

    private async findExistingAutomationOrderForDate(
        order: Pick<UpsellOrder, 'listing_id' | 'type' | 'client_name'>,
        lookupDate: Date
    ) {
        const startOfDay = new Date(new Date(lookupDate).setHours(0, 0, 0, 0));
        const endOfDay = new Date(new Date(lookupDate).setHours(23, 59, 59, 999));

        return this.upsellOrderRepo.createQueryBuilder('upsell_order')
            .where('upsell_order.listing_id = :listingId', { listingId: order.listing_id })
            .andWhere('upsell_order.type = :type', { type: order.type })
            .andWhere('(upsell_order.order_date BETWEEN :startOfDay AND :endOfDay OR upsell_order.requested_date BETWEEN :startOfDay AND :endOfDay)', {
                startOfDay,
                endOfDay,
            })
            .getOne();
    }

    private async setRequestedDateIfSupported(orderId: number, requestedDate?: Date | null) {
        if (!requestedDate || Number.isNaN(requestedDate.getTime())) return;
        await this.upsellOrderRepo.query(
            'UPDATE upsell_orders SET requested_date = ? WHERE id = ?',
            [requestedDate, orderId]
        ).catch(() => undefined);
    }
}
