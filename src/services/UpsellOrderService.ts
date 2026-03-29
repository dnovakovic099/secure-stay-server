import { appDatabase } from "../utils/database.util";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Between, ILike, In, IsNull, Not } from "typeorm";
import { sendUpsellOrderEmail } from './UpsellEmailService';
import logger from "../utils/logger.utils";
import { HostAwayClient } from "../client/HostAwayClient";
import { ListingService } from "./ListingService";
import { categoryIds, tagIds } from "../constant";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { ReservationInfoEntity } from "../entity/ReservationInfo";

export class UpsellOrderService {
    private upsellOrderRepo = appDatabase.getRepository(UpsellOrder);
    private hostAwayClient = new HostAwayClient();
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);
    private requestedDateColumnPromise: Promise<boolean> | null = null;

    async createOrder(data: Partial<UpsellOrder>, userId: string) {
        const requestedDate = (data as any).requested_date || (data as any).requestedDate || null;
        delete (data as any).requested_date;
        delete (data as any).requestedDate;

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
        await this.setRequestedDateIfSupported(savedOrder.id, requestedDate);
        await sendUpsellOrderEmail(savedOrder);
        return savedOrder;
    }

    async getOrders(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string | string[] = '', listing_id: string | string[] = '', dateType: string = 'order_date', keyword: string = '', propertyType: string[] | string = [], upsellType: string[] | string = []) {
        const queryOptions: any = {
            order: { order_date: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
            where: {}
        };

        const statusFilters = this.expandStatusFilters(this.parseStringArray(status));
        const listingFilters = this.parseStringArray(listing_id);
        const propertyTypeFilters = this.parseStringArray(propertyType);
        const upsellTypeFilters = this.parseStringArray(upsellType);

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

        if (statusFilters.length > 0) {
            queryOptions.where.status = In(statusFilters);
        }

        if (listingFilters.length > 0) {
            queryOptions.where.listing_id = In(listingFilters);
        }

        if (propertyTypeFilters.length > 0) {
            const listingService = new ListingService();
            const listingIds = (await listingService.getListingsByPropertyTypes(propertyTypeFilters)).map(l => String(l.id));
            const mergedListingIds = listingFilters.length > 0
                ? listingIds.filter((id) => listingFilters.includes(id))
                : listingIds;
            queryOptions.where.listing_id = In(mergedListingIds.length > 0 ? mergedListingIds : ["__none__"]);
        }

        if (upsellTypeFilters.length > 0) {
            queryOptions.where.type = In(upsellTypeFilters);
        }

        const where = keyword
        ? [
            { ...queryOptions.where, client_name: ILike(`%${keyword}%`) },
            { ...queryOptions.where, type: ILike(`%${keyword}%`) },
        ]
        : queryOptions.where;

        queryOptions.where = where;

        const [orders, total] = await this.upsellOrderRepo.findAndCount(queryOptions);
        const requestedDateMap = await this.getRequestedDateMap(orders.map((order) => order.id));

        // Backfill listing_name and property_owner for existing records if missing
        if (orders.length > 0) {
            const listingService = new ListingService();
            const allListings = await listingService.getListingNames('', true);
            const listingMap = new Map(allListings.map(l => [String(l.id), l]));
            const reservationIds = orders.map((order) => Number(order.booking_id)).filter((value) => Number.isFinite(value));
            const reservations = reservationIds.length > 0
                ? await this.reservationInfoRepo.find({ where: { id: In(reservationIds) } })
                : [];
            const reservationMap = new Map(reservations.map((reservation) => [String(reservation.id), reservation]));

            orders.forEach((order: any) => {
                const listing = listingMap.get(String(order.listing_id));
                const reservation = reservationMap.get(String(order.booking_id));
                if (listing) {
                    if (!order.listing_name || order.listing_name === '-') {
                        order.listing_name = listing.internalListingName || '';
                    }
                    if (!order.property_owner) {
                        order.property_owner = (listing as any).ownerName || '';
                    }
                    order.property_type = this.getPropertyTypeFromTags((listing as any).tags);
                }
                order.channel_name = reservation?.channelName || '';
                order.requested_date = requestedDateMap.get(order.id) || order.created_at || null;
                order.status = this.normalizeDisplayStatus(order.status);
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

        const requestedDate = (data as any).requested_date || (data as any).requestedDate;
        delete (data as any).requested_date;
        delete (data as any).requestedDate;

        if (existingOrder.ha_id) {
            const existingPaid = this.isPaidStatus(existingOrder.status);
            const nextPaid = data.status ? this.isPaidStatus(String(data.status)) : existingPaid;
            if (existingPaid && !nextPaid) {
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
        if (requestedDate !== undefined) {
            await this.setRequestedDateIfSupported(id, requestedDate);
        }
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
        const orders = await this.upsellOrderRepo.find({ where: { booking_id: String(reservationId), status: In(["Approved", "Paid"]) } });
        return orders.map(order => ({
            type: order.type,
            upsellId: String(order.id)
        }));
    }

    /**
     * Batch fetch upsells for multiple reservations
     * Used for performance optimization to avoid N+1 queries
     */
    async getUpsellsByReservationIds(reservationIds: number[]): Promise<Map<number, { type: string; upsellId: string; }[]>> {
        if (reservationIds.length === 0) {
            return new Map();
        }

        const bookingIds = reservationIds.map(id => String(id));
        const orders = await this.upsellOrderRepo.find({
            where: { booking_id: In(bookingIds), status: In(["Approved", "Paid"]) }
        });

        const result = new Map<number, { type: string; upsellId: string; }[]>();
        // Initialize all requested IDs with empty arrays
        for (const id of reservationIds) {
            result.set(id, []);
        }
        // Group upsells by reservation
        for (const order of orders) {
            const reservationId = Number(order.booking_id);
            const upsells = result.get(reservationId) || [];
            upsells.push({ type: order.type, upsellId: String(order.id) });
            result.set(reservationId, upsells);
        }
        return result;
    }

    private async getUpsellsByCheckoutDate(date: string) {
        return await this.upsellOrderRepo.find({
            where: {
                departure_date: Between("2025-07-02", date), // process upsells on checkout feature was made live on July 2, 2025
                status: In(["Approved", "Paid"])
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
                status: In(["Approved", "Paid"]),
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

    private parseStringArray(value: string[] | string | undefined | null) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item).trim()).filter(Boolean);
        }
        return String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    private expandStatusFilters(statuses: string[]) {
        const expanded = new Set<string>();
        statuses.forEach((status) => {
            switch (status) {
                case "Interested":
                    expanded.add("Interested");
                    expanded.add("Ordered");
                    break;
                case "Paid":
                    expanded.add("Paid");
                    expanded.add("Approved");
                    break;
                case "Cancelled":
                    expanded.add("Cancelled");
                    expanded.add("Denied");
                    expanded.add("Refunded");
                    break;
                default:
                    expanded.add(status);
                    break;
            }
        });
        return Array.from(expanded);
    }

    private normalizeDisplayStatus(status?: string | null) {
        switch (String(status || "").trim()) {
            case "Ordered":
                return "Interested";
            case "Approved":
                return "Paid";
            case "Denied":
            case "Refunded":
                return "Cancelled";
            default:
                return String(status || "");
        }
    }

    private isPaidStatus(status?: string | null) {
        return ["Approved", "Paid"].includes(String(status || "").trim());
    }

    private getPropertyTypeFromTags(tags?: string | null) {
        const tagList = String(tags || "")
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        if (tagList.includes("own")) return "Own";
        if (tagList.includes("arb")) return "Arb";
        if (tagList.includes("pm")) return "PM";
        return "";
    }

    private async hasRequestedDateColumn() {
        if (!this.requestedDateColumnPromise) {
            this.requestedDateColumnPromise = this.upsellOrderRepo.query(
                `SELECT COUNT(*) as count
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'upsell_orders'
                   AND COLUMN_NAME = 'requested_date'`
            ).then((rows: Array<{ count: number | string }>) => Number(rows?.[0]?.count || 0) > 0)
             .catch(() => false);
        }
        return this.requestedDateColumnPromise;
    }

    private async getRequestedDateMap(orderIds: number[]) {
        const map = new Map<number, string>();
        if (orderIds.length === 0 || !(await this.hasRequestedDateColumn())) {
            return map;
        }
        const placeholders = orderIds.map(() => '?').join(', ');
        const rows = await this.upsellOrderRepo.query(
            `SELECT id, requested_date FROM upsell_orders WHERE id IN (${placeholders})`,
            orderIds
        );
        rows.forEach((row: { id: number; requested_date: string | null }) => {
            if (row.requested_date) map.set(Number(row.id), row.requested_date);
        });
        return map;
    }

    private async setRequestedDateIfSupported(orderId: number, requestedDate?: string | null) {
        if (requestedDate === undefined || !(await this.hasRequestedDateColumn())) {
            return;
        }
        await this.upsellOrderRepo.query(
            `UPDATE upsell_orders SET requested_date = ? WHERE id = ?`,
            [requestedDate || null, orderId]
        );
    }
}
