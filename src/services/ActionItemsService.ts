import { appDatabase } from "../utils/database.util";
import { ActionItems } from "../entity/ActionItems";
import { Listing } from "../entity/Listing";
import logger from "../utils/logger.utils";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Between, In } from "typeorm";
import { start } from "repl";
import { UsersEntity } from "../entity/Users";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { ReservationInfoService } from "./ReservationInfoService";
import { ReservationService } from "./ReservationService";
import { Issue } from "../entity/Issue";
import { IssuesService } from "./IssuesService";

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
    private actionItemsUpdatesRepo = appDatabase.getRepository(ActionItemsUpdates);

    async createAtionItemFromHostbuddy(actionItems: HostBuddyActionItem) {
        const { property_name, guest_name, category, status, item } = actionItems;

        const listing = await this.listingRepo.findOne({
            where: { internalListingName: property_name },
            order: { listingId: "DESC" }
        });
        
        if (!listing) {
            logger.error(`Listing with name ${property_name} not found`);
        }

        const reservation = await this.reservationInfoRepo.findOne({ where: { guestName: guest_name } });
        if (!reservation) {
            logger.error(`Reservation for guest ${guest_name} not found`);
        }

        const actionItem = new ActionItems();
        actionItem.listingName = property_name;
        actionItem.listingId = listing ? listing.id : reservation ? reservation.listingMapId : null;
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
            ids
        } = filter;

        const whereConditions = {
            ...(ids?.length > 0 && { id: In(ids) }),
            ...(category && { category: In(category) }),
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
            relations: ["actionItemsUpdates"],
            take: limit,
            order: { createdAt: 'DESC' },
        });

        const transformedActionItems = actionItems.map(actionItem => {
            return {
                ...actionItem,
                createdBy: userMap.get(actionItem.createdBy) || actionItem.createdBy,
                updatedBy: userMap.get(actionItem.updatedBy) || actionItem.updatedBy,
                actionItemsUpdates: actionItem.actionItemsUpdates.map(update => ({
                    ...update,
                    createdBy: userMap.get(update.createdBy) || update.createdBy,
                    updatedBy: userMap.get(update.updatedBy) || update.updatedBy
                })),
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


    async createActionItemsUpdates(body: any, userId: string) {
        const { actionItemId, updates } = body;

        const actionItem = await this.actionItemsRepo.findOne({ where: { id: actionItemId } });
        if (!actionItem) {
            throw CustomErrorHandler.notFound(`Action item with ID ${actionItemId} not found`);
        }

        const newUpdate = this.actionItemsUpdatesRepo.create({
            actionItems: actionItem,
            updates: updates,
            createdBy: userId,
        });

        const result = await this.actionItemsUpdatesRepo.save(newUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        return result;
    }

    async updateActionItemsUpdates(body: any, userId: string) {
        const { id, updates } = body;

        const existingActionItemUpdate = await this.actionItemsUpdatesRepo.findOne({ where: { id } });
        if (!existingActionItemUpdate) {
            throw CustomErrorHandler.notFound(`Action item update with ID ${id} not found`);
        }
        existingActionItemUpdate.updates = updates;
        existingActionItemUpdate.updatedBy = userId;

        const result = await this.actionItemsUpdatesRepo.save(existingActionItemUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user.firstName} ${user.lastName}`]));
        result.createdBy = userMap.get(result.createdBy) || result.createdBy;
        return result;
    }

    async deleteActionItemsUpdates(id: number, userId: string) {
        const existingActionItemUpdate = await this.actionItemsUpdatesRepo.findOne({ where: { id } });
        if (!existingActionItemUpdate) {
            throw CustomErrorHandler.notFound(`Action item update with ID ${id} not found`);
        }

        existingActionItemUpdate.deletedBy = userId;
        existingActionItemUpdate.deletedAt = new Date();

        return await this.actionItemsUpdatesRepo.save(existingActionItemUpdate);
    }

    async migrateActionItemsToIssues(body: any, userId: string) {
        const { id, status } = body;

        const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
        if (!actionItem) {
            throw CustomErrorHandler.notFound(`Action item with ID ${id} not found`);
        }

        const reservationInfoService = new ReservationInfoService();
        const reservationInfo = await reservationInfoService.getReservationById(actionItem.reservationId);
        if (!reservationInfo) {
            logger.warn(`[migrateActionItemsToIssues] No reservation info found for guest: ${actionItem.guestName}`);
            throw CustomErrorHandler.notFound(`Reservation info for guest ${actionItem.guestName} not found`);
        }

        const reservationService = new ReservationService();
        const channels = await reservationService.getChannelList();
        const channel = channels.find(c => c.channelId === reservationInfo.channelId).channelName;
        const creator = "Hostbuddy";

        const data: Partial<Issue> = {
            channel,
            listing_id: String(reservationInfo.listingMapId),
            check_in_date: reservationInfo.arrivalDate,
            reservation_amount: Number(reservationInfo.totalPrice),
            guest_name: reservationInfo.guestName,
            guest_contact_number: reservationInfo.phone,
            issue_description: `[MOVED FROM ACTION ITEM]  ${actionItem.item}`,
            creator,
            status: status,
            reservation_id: String(reservationInfo.id),
            claim_resolution_status: "N/A",
            estimated_reasonable_price: 0,
            final_price: 0,
            claim_resolution_amount: 0
        };

        try {
            const issueService = new IssuesService();
            const issue = await issueService.createIssue(data, creator, []);
            logger.info(`[migrateActionItemsToIssues] Issue created successfully`);
            await this.deleteActionItem(id, userId);
            logger.info(`[migrateActionItemsToIssues] Action item with ID ${id} deleted successfully after migrating to issue ${issue?.id}`);
            return issue;
        } catch (error) {
            logger.error(`[migrateActionItemsToIssues] Error creating issue: ${error.message}`);
        }
    }

    async updateActionItemStatus(id: number, status: string, userId: string) {
        const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
        if (!actionItem) {
            logger.error(`[updateActionItemStatus] Action item with id ${id} not found.`);
            return null;
        }
        actionItem.status = status;
        actionItem.updatedBy = userId;
        return await this.actionItemsRepo.save(actionItem);
    }

}
