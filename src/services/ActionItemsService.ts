import { appDatabase } from "../utils/database.util";
import { ActionItems } from "../entity/ActionItems";
import { Listing } from "../entity/Listing";
import logger from "../utils/logger.utils";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Between, In } from "typeorm";
import { start } from "repl";
import { UsersEntity } from "../entity/Users";

interface ActionItemFilter {
    category?: string;
    page: number;
    limit: number;
    listingId?: string[];
    guestName?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
}

interface HostBuddyActionItem {
    property_name: string;
    guest_name: string;
    item: string;
    category: string;
    status: string;
}

export class ActionItemsService {
    private actionItemsRepo = appDatabase.getRepository(ActionItems);
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);

    async createAtionItemFromHostbuddy(actionItems: HostBuddyActionItem) {
        const { property_name, guest_name, category, status, item } = actionItems;

        const listing = await this.listingRepo.findOne({ where: { internalListingName: property_name } });
        if (!listing) {
            logger.error(`Listing with name ${property_name} not found`);
        }

        const reservation = await this.reservationInfoRepo.findOne({ where: { guestName: guest_name } });
        if (!reservation) {
            logger.error(`Reservation for guest ${guest_name} not found`);
        }

        const actionItem = new ActionItems();
        actionItem.listingName = property_name;
        actionItem.listingId = listing ? listing.id : null;
        actionItem.guestName = guest_name;
        actionItem.reservationId = reservation ? reservation.id : null;
        actionItem.item = item;
        actionItem.category = category;
        actionItem.status = status;
        actionItem.createdBy = 'system';

        return await this.actionItemsRepo.save(actionItem);
    }

    async getActionItems(filter: any) {
        const {
            category,
            page = 1,
            limit = 10,
            listingId,
            guestName,
            status,
            fromDate,
            toDate,
        } = filter;

        const whereConditions = {
            ...(category && { category }),
            ...(listingId?.length > 0 && { listingId: In(listingId) }),
            ...(guestName && { guestName }),
            ...(status && { status: In(status) }),
            ...(fromDate && toDate && {
                createdAt: Between(
                    new Date(new Date(fromDate).setHours(0, 0, 0, 0)),
                    new Date(new Date(toDate).setHours(23, 59, 59, 999))
                ),
            }),
        };

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));


        const [actionItems, total] = await this.actionItemsRepo.findAndCount({
            where: whereConditions,
            skip: (page - 1) * limit,
            take: limit,
            order: { createdAt: 'DESC' },
        });

        const transformedActionItems = actionItems.map(items => {
            return {
                ...items,
                createdBy: userMap.get((items.createdBy)) || items.createdBy,
                updatedBy: userMap.get(items.updatedBy) || items.updatedBy,
                deletedBy: userMap.get(items.deletedBy) || items.deletedBy,
            };
        });

        return { actionItems: transformedActionItems, total };
    }


    async createActionItem(actionItem: ActionItems, userId: string) {
        const { listingName, guestName, item, category, status, listingId, reservationId } = actionItem;

        const newActionItem = new ActionItems();
        newActionItem.listingName = listingName;
        newActionItem.listingId = listingId;
        newActionItem.guestName = guestName;
        newActionItem.reservationId = reservationId;
        newActionItem.item = item;
        newActionItem.category = category;
        newActionItem.status = status;
        newActionItem.createdBy = userId;

        return await this.actionItemsRepo.save(newActionItem);
    }

    async updateActionItem(actionItem: ActionItems, userId: string) {
        const existingActionItem = await this.actionItemsRepo.findOne({ where: { id: actionItem.id } });
        if (!existingActionItem) {
            throw CustomErrorHandler.notFound(`Action item with ID ${actionItem.id} not found`);
        }

        existingActionItem.listingName = actionItem.listingName;
        existingActionItem.guestName = actionItem.guestName;
        existingActionItem.item = actionItem.item;
        existingActionItem.category = actionItem.category;
        existingActionItem.status = actionItem.status;
        existingActionItem.listingId = actionItem.listingId;
        existingActionItem.reservationId = actionItem.reservationId;
        existingActionItem.updatedBy = userId;

        return await this.actionItemsRepo.save(existingActionItem);
    }

    async deleteActionItem(id: number, userId: string) {
        const existingActionItem = await this.actionItemsRepo.findOne({ where: { id } });
        if (!existingActionItem) {
            throw CustomErrorHandler.notFound(`Action item with ID ${id} not found`);
        }

        existingActionItem.deletedBy = userId;
        existingActionItem.deletedAt = new Date();

        return await this.actionItemsRepo.save(existingActionItem);
    }


}
