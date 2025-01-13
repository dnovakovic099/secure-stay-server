import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { ChargeAutomationService } from "./ChargeAutomationService";
import { Between } from "typeorm";
import { sendUpsellOrderEmail } from './UpsellEmailService';

export class UpsellOrderService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);
    private chargeAutomationService = new ChargeAutomationService();

    async createOrder(data: Partial<UpsellOrder>) {
        const order = this.upsellOrderRepo.create(data);
        const savedOrder = await this.upsellOrderRepo.save(order);
        await sendUpsellOrderEmail(savedOrder);
        return savedOrder;
    }

    async getOrders(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string = '', listing_id: string = '') {
        await this.chargeAutomationService.fetchNewUpsellOrders();

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

    async updateOrder(id: number, data: Partial<UpsellOrder>) {
        await this.upsellOrderRepo.update(id, data);
        return await this.upsellOrderRepo.findOne({ where: { id } });
    }

    async deleteOrder(id: number) {
        return await this.upsellOrderRepo.delete(id);
    }
} 