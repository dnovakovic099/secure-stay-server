import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Between, In, Not } from "typeorm";
import { sendUpsellOrderEmail } from './UpsellEmailService';
import logger from "../utils/logger.utils";
import { HostAwayClient } from "../client/HostAwayClient";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant";

export class UpsellOrderService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);
    private hostAwayClient = new HostAwayClient();

    async createOrder(data: Partial<UpsellOrder>, userId: string) {
        const order = this.upsellOrderRepo.create({ ...data, created_by: userId });
        const savedOrder = await this.upsellOrderRepo.save(order);
        await sendUpsellOrderEmail(savedOrder);
        return savedOrder;
    }

    async getOrders(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string = '', listing_id: string = '', dateType: string = 'order_date') {
        const queryOptions: any = {
            order: { order_date: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
            where: {}
        };

        if (fromDate && toDate) {
            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);

            const validDateTypes = ['order_date', 'arrival_date', 'departure_date'];
            if (!validDateTypes.includes(dateType)) {
                dateType = 'order_date';
            }

            queryOptions.where[dateType] = Between(startDate, endDate);
        }

        if (status && Array.isArray(status)) {
            queryOptions.where.status = In(status);
        }  

        if (listing_id && Array.isArray(listing_id)) {
            queryOptions.where.listing_id = In(listing_id);
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
        const existingOrder = await this.upsellOrderRepo.findOne({ where: { id } });
        if (existingOrder.ha_id) {
            if (existingOrder.status == "Approved" && data.status && data.status !== "Approved") {
                //delete the expense in HostAway
                const clientId = process.env.HOST_AWAY_CLIENT_ID;
                const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;
                await this.hostAwayClient.deleteExpense(existingOrder.ha_id, clientId, clientSecret);
                logger.info(`Deleted extras with ID ${existingOrder.ha_id} in HostAway for order ID ${id}`);
                existingOrder.ha_id = null; // Reset ha_id after deletion
                await this.upsellOrderRepo.save(existingOrder);
            }
        }

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
                    fromDate,
                    toDate
                ),
                type: "Early Check-in"
            }
        });

        const otherUpsells = await this.upsellOrderRepo.find({
            where: {
                listing_id: String(listingId),
                departure_date: Between(
                    fromDate,
                    toDate
                ),
                type: Not("Early Check-in")
            }
        });
        return [...earlyCheckInUpsells, ...otherUpsells]
    }

    async getUpsellsByReservationId(reservationId: number) {
        const orders = await this.upsellOrderRepo.find({ where: { booking_id: String(reservationId), status:"Approved" } });
        return orders.map(order => ({
            type: order.type,
            upsellId: String(order.id)
        }));
    }

    private async getUpsellsByCheckoutDate(date: string) {
        return await this.upsellOrderRepo.find({
            where: {
                departure_date: date,
                status: "Approved"
            }
        });
    }

    private async prepareExtrasObject(upsell: UpsellOrder) {
        const categories = JSON.stringify([19780]);

        const listingService = new ListingService();
        const pmListings = await listingService.getListingsByTagIds([tagIds.PM]);
        const isPmListing = pmListings.some(listing => listing.id == Number(upsell.listing_id));

        let netAmount = 0;
        if (isPmListing) {
            const processingFee = upsell.cost * 0.03;
            netAmount = Math.round(upsell.cost - processingFee);
            const listingPmFee = await listingService.getListingPmFee();
            let pmFeePercent = (listingPmFee.find((listing) => listing.listingId == Number(upsell.listing_id))?.pmFee) / 100 || 0.1; // default to 10% if not found
            const pmFee = netAmount * pmFeePercent;
            netAmount = netAmount - pmFee;
        } else {
            netAmount = upsell.cost;
        }

        return {
            listingMapId: upsell.listing_id,
            expenseDate: upsell.departure_date,
            concept: upsell.type,
            amount: netAmount,
            categories: JSON.parse(categories),
            reservationId: Number(upsell.booking_id)
        };
    }

    public async processCheckoutDateUpsells(date: string) {
        const upsells = await this.getUpsellsByCheckoutDate(date);
        if (upsells.length === 0) {
            logger.info(`No upsells found for checkout date: ${date}`);
            return [];
        }

        for (const upsell of upsells) {
            if (upsell.ha_id) {
                continue;
            }
            try {
                //create expense in hostaway
                const requestBody = await this.prepareExtrasObject(upsell);
                const clientId = process.env.HOST_AWAY_CLIENT_ID;
                const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;

                const hostawayExpense = await this.hostAwayClient.createExpense(requestBody, { clientId, clientSecret });
                if (hostawayExpense) {
                    const expenseId = hostawayExpense.id;
                    upsell.ha_id = expenseId;
                    await this.upsellOrderRepo.save(upsell);
                } else {
                    throw new Error("Failed to create expense in HostAway");
                }

            } catch (error) {
                logger.error(`Error processing upsell for checkout date ${date}: ${error.message}`);
            }
        }
    }
}