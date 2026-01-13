import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Between, ILike, In, IsNull, Not } from "typeorm";
import { sendUpsellOrderEmail } from './UpsellEmailService';
import logger from "../utils/logger.utils";
import { HostAwayClient } from "../client/HostAwayClient";
import { ListingService } from "./ListingService";
import { categoryIds, tagIds } from "../constant";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";

export class UpsellOrderService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);
    private hostAwayClient = new HostAwayClient();
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);

    async createOrder(data: Partial<UpsellOrder>, userId: string) {
        // Fetch listing name and owner if listing_id is provided
        if (data.listing_id) {
            const listingService = new ListingService();
            const listings = await listingService.getAllListingsForLookup(true);
            const listing = listings.find(l => String(l.id) === String(data.listing_id));
            if (listing) {
                if (!data.listing_name) {
                    data.listing_name = listing.internalListingName || '';
                }

                // Also fetch full listing details for owner name
                const fullListing = await listingService.getListingInfo(Number(data.listing_id), userId);
                if (fullListing && !data.property_owner) {
                    data.property_owner = fullListing.ownerName || '';
                }
            }
        }

        const order = this.upsellOrderRepo.create({ ...data, created_by: userId });
        const savedOrder = await this.upsellOrderRepo.save(order);
        await sendUpsellOrderEmail(savedOrder);
        return savedOrder;
    }

    async getOrders(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string = '', listing_id: string = '', dateType: string = 'order_date', keyword: string = '', propertyType: string = '') {
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

        if (propertyType && Array.isArray(propertyType)) {
            const listingService = new ListingService();
            const listingIds = (await listingService.getListingsByTagIds(propertyType)).map(l => l.id);
            queryOptions.where.listing_id = In(listingIds);
        }

        const where = keyword
        ? [
            { ...queryOptions.where, client_name: ILike(`%${keyword}%`) },
            { ...queryOptions.where, type: ILike(`%${keyword}%`) },
        ]
        : queryOptions.where;

        queryOptions.where = where;

        const [orders, total] = await this.upsellOrderRepo.findAndCount(queryOptions);

        // Backfill listing_name and property_owner for existing records if missing
        if (orders.length > 0) {
            const listingService = new ListingService();
            const allListings = await listingService.getListings('', true);
            const listingMap = new Map(allListings.map(l => [String(l.id), l]));

            orders.forEach(order => {
                const listing = listingMap.get(String(order.listing_id));
                if (listing) {
                    if (!order.listing_name || order.listing_name === '-') {
                        order.listing_name = listing.internalListingName || '';
                    }
                    if (!order.property_owner) {
                        order.property_owner = listing.ownerName || '';
                    }
                }
            });
        }

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
        if (!existingOrder) {
            throw new Error("Order not found");
        }

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

        // Fetch listing name and owner if listing_id is changed
        if (data.listing_id && String(data.listing_id) !== String(existingOrder.listing_id)) {
            const listingService = new ListingService();
            const listings = await listingService.getAllListingsForLookup(true);
            const listing = listings.find(l => String(l.id) === String(data.listing_id));
            if (listing) {
                data.listing_name = listing.internalListingName || '';

                const fullListing = await listingService.getListingInfo(Number(data.listing_id), userId);
                if (fullListing) {
                    data.property_owner = fullListing.ownerName || '';
                }
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
                departure_date: Between("2025-07-02", date), // process upsells on checkout feature was made live on July 2, 2025
                status: "Approved"
            }
        });
    }

    private async prepareExtrasObject(upsell: UpsellOrder) {
        const categories = JSON.stringify([categoryIds.Upsell]);

        const listingService = new ListingService();
        const pmListings = await listingService.getPmListings();
        const isPmListing = pmListings.some(listing => listing.id == Number(upsell.listing_id));

        let netAmount = 0;
        if (isPmListing) {
            const processingFee = upsell.cost * 0.03;
            netAmount = Math.ceil(upsell.cost - processingFee);
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
            logger.info(`[processCheckoutDateUpsells]No upsells found for checkout date: ${date}`);
            return [];
        }
        logger.info(`[processCheckoutDateUpsells]Processing ${upsells.length} upsells for checkout date: ${date}`);

        for (const upsell of upsells) {
            // logger.info(`[processCheckoutDateUpsells]Processing upsell ID: ${upsell.id}, Type: ${upsell.type}, Listing ID: ${upsell.listing_id}`);
            if (upsell.ha_id) {
                // logger.info(`[processCheckoutDateUpsells]Upsell ID ${upsell.id} already has a HostAway ID: ${upsell.ha_id}. Skipping.`);
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
                    logger.info(`[processCheckoutDateUpsells]Created expense in HostAway with ID: ${expenseId} for upsell ID: ${upsell.id}`);

                    //create expense in internal system as well
                    const expense = this.expenseRepo.create({
                        expenseId: Number(expenseId),
                        listingMapId: Number(upsell.listing_id),
                        expenseDate: upsell.departure_date,
                        concept: upsell.type,
                        amount: requestBody.amount,
                        isDeleted: 0,
                        categories: JSON.stringify([categoryIds.Upsell]),
                        contractorName: "",
                        contractorNumber: "",
                        dateOfWork: null,
                        datePaid: null,
                        status: ExpenseStatus.APPROVED,
                        userId: 'system',
                        createdBy: 'system',
                        reservationId: upsell.booking_id,
                        guestName: upsell.client_name
                    });

                    await this.expenseRepo.save(expense);
                } else {
                    logger.error(`[processCheckoutDateUpsells]Failed to create expense in HostAway for upsell ID: ${upsell.id}`);
                }

            } catch (error) {
                logger.error(`Error processing upsell for checkout date ${date}: ${error.message}`);
            }
        }
    }


    async scriptToCreateMissingExtrasFromUpsell(date: string) {
        const upsells = await this.upsellOrderRepo.find({
            where: {
                departure_date: Between("2025-07-02", date), // process upsells on checkout feature was made live on July 2, 2025
                status: "Approved",
                ha_id: Not(IsNull())
            }
        });

        logger.info(`[scriptToCreateMissingExtrasFromUpsell] Found ${upsells.length} upsells with HostAway IDs up to date: ${date}`);

        for (const upsell of upsells) {
            try {
                const requestBody = await this.prepareExtrasObject(upsell);
                //create expense in internal system as well
                const existingExpense = await this.expenseRepo.findOne({ where: { expenseId: Number(upsell.ha_id) } });
                if (existingExpense) {
                    logger.info(`Expense already exists for upsell ID: ${upsell.id}, skipping...`);
                    existingExpense.amount = requestBody.amount;
                    existingExpense.upsellId = upsell.id;
                    await this.expenseRepo.save(existingExpense);
                    continue;
                }

                const expense = this.expenseRepo.create({
                    expenseId: Number(upsell.ha_id),
                    listingMapId: Number(upsell.listing_id),
                    expenseDate: upsell.departure_date,
                    concept: upsell.type,
                    amount: requestBody.amount,
                    isDeleted: 0,
                    categories: JSON.stringify([categoryIds.Upsell]),
                    contractorName: "",
                    contractorNumber: "",
                    dateOfWork: null,
                    datePaid: null,
                    status: ExpenseStatus.APPROVED,
                    userId: 'system',
                    createdBy: 'system',
                    reservationId: upsell.booking_id,
                    guestName: upsell.client_name,
                    fileNames: "",
                    upsellId: upsell.id
                });

                await this.expenseRepo.save(expense);
                logger.info(`Created internal expense record for upsell ID: ${upsell.id}`);
            } catch (error) {
                logger.error(`Error creating internal expense for upsell ID ${upsell.id}: ${error.message}`);
            }
        }
    }
}