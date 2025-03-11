import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Between, Not } from "typeorm";
import { sendUpsellOrderEmail } from './UpsellEmailService';

export class UpsellOrderService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);

    async createOrder(data: Partial<UpsellOrder>, userId: string) {
        const order = this.upsellOrderRepo.create({ ...data, created_by: userId });
        const savedOrder = await this.upsellOrderRepo.save(order);
        await sendUpsellOrderEmail(savedOrder);
        return savedOrder;
    }

    async getOrders(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string = '', listing_id: string = '') {

        const queryOptions: any = {
            order: { order_date: 'DESC' },
            skip: (page - 1) * limit,
            take: limit
        };

        if (fromDate && toDate) {
            queryOptions.where = {
                order_date: Between(
                    new Date(fromDate),
                    new Date(toDate)
                )
            };
        }

        if (status) {
            queryOptions.where.status = status;
        }   

        if (listing_id) {
            queryOptions.where.listing_id = listing_id;
        }

        const [orders, total] = await this.upsellOrderRepo.findAndCount(queryOptions);

        return {
            data: orders,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateOrder(id: number, data: Partial<UpsellOrder>, userId: string) {
        await this.upsellOrderRepo.update(id, { ...data, updated_by: userId, updated_at: new Date() });
        return await this.upsellOrderRepo.findOne({ where: { id } });
    }

    async deleteOrder(id: number) {
        return await this.upsellOrderRepo.delete(id);
    }

    async getUpsells(fromDate: string, toDate: string, listingId: number) {
        const earlyCheckInUpsells = await this.upsellOrderRepo.find({
            where: {
                listing_id: String(listingId),
                arrival_date: Between(
                    new Date(fromDate),
                    new Date(toDate)
                ),
                type: "Early Check-in"
            }
        });

        const otherUpsells = await this.upsellOrderRepo.find({
            where: {
                listing_id: String(listingId),
                departure_date: Between(
                    new Date(fromDate),
                    new Date(toDate),
                ),
                type: Not("Early Check-in")
            }
        });
        return [...earlyCheckInUpsells, ...otherUpsells]
    }

    async getUpsellsByReservationId(reservationId: number) {
        const orders = await this.upsellOrderRepo.find({ where: { booking_id: String(reservationId) } });
        return orders.map(order => ({
            type: order.type,
            upsellId: String(order.id)
        }));
    }
}