import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
    In,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildExpenseSlackMessage, buildExpenseSlackMessageUpdate, buildExpenseSlackMessageDelete, buildExpenseStatusUpdateMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { ExpenseEntity } from '../entity/Expense';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { CategoryEntity } from '../entity/Category';
import updateSlackMessage from '../utils/updateSlackMsg';
import { updateResolutionFromExpense } from '../queue/expenseQueue';
import { getSlackUsers } from '../utils/getSlackUsers';
import { getCachedUserMap } from '../utils/usersCache.util';

@EventSubscriber()
export class ExpenseSubscriber
    implements EntitySubscriberInterface<ExpenseEntity> {

    listenTo() {
        return ExpenseEntity;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);
    private categoryRepo = appDatabase.getRepository(CategoryEntity);

    private expenseChangeLabels: Record<string, string> = {
        listingMapId: "Property",
        expenseDate: "Expense Date",
        concept: "Description",
        amount: "Amount",
        categories: "Categories",
        dateOfWork: "Date of Work",
        contractorName: "Contractor",
        contractorNumber: "Contractor Number",
        findings: "Findings",
        status: "Status",
        paymentMethod: "Payment Method",
        paymentDetails: "Payment Details",
        datePaid: "Date Paid",
        issues: "Issues",
        isRecurring: "Recurring",
        llCover: "Covered by Luxury Lodging",
        comesFrom: "Source",
        reservationId: "Reservation",
        guestName: "Guest Name",
        fileNames: "Attachments"
    };

    private excludedChangeFields = new Set([
        "id",
        "expenseId",
        "isDeleted",
        "userId",
        "createdAt",
        "updatedAt",
        "createdBy",
        "updatedBy",
        "upsellId",
        "resolutionId"
    ]);

    private async resolvePaymentDetailsMentions(expense: ExpenseEntity) {
        if (!expense.paymentDetails) return expense;
        const slackUsers = await getSlackUsers();
        const userByHandle = new Map(
            slackUsers.map((user: any) => [String(user.name || '').toLowerCase(), user.id])
        );
        const paymentDetails = expense.paymentDetails.replace(/@([A-Za-z0-9._-]+)/g, (match, handle) => {
            const slackId = userByHandle.get(String(handle || '').toLowerCase());
            return slackId ? `<@${slackId}>` : match;
        });

        return { ...expense, paymentDetails };
    }

    async afterInsert(event: InsertEvent<ExpenseEntity>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(expense: ExpenseEntity, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : userId;

            const listingInfo = await this.listingRepo.findOne({ where: { id: expense.listingMapId } });
            const categoryNames = await this.getCategoryNames(expense.categories);

            const slackMessageService = new SlackMessageService();
            const expenseForSlack = await this.resolvePaymentDetailsMentions(expense);
            const slackMessage = buildExpenseSlackMessage(expenseForSlack as ExpenseEntity, user, listingInfo?.internalListingName, undefined, categoryNames);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "expense",
                entityId: expense.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    private async getCategoryNames(categoriesJson: string): Promise<string> {
        if (!categoriesJson) return '';

        try {
            const categoryIds = JSON.parse(categoriesJson);
            if (!Array.isArray(categoryIds)) return '';

            const categories = await this.categoryRepo.find({
                where: { hostawayId: In(categoryIds) }
            });

            return categoryIds.map(id => {
                const category = categories.find(cat => cat.hostawayId === id);
                return category ? category.categoryName : 'Unknown Category';
            }).join(', ');
        } catch (error) {
            logger.error('Error parsing categories:', error);
            return '';
        }
    }

    private escapeSlackText(value: string) {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    private formatBooleanValue(value: any) {
        return value ? "Yes" : "No";
    }

    private formatAttachmentNames(value: any) {
        if (!value) return "-";
        try {
            const parsed = typeof value === "string" ? JSON.parse(value) : value;
            if (Array.isArray(parsed)) return parsed.join(", ") || "-";
        } catch {
            return String(value);
        }
        return String(value);
    }

    private async formatChangeValue(field: string, value: any) {
        if (value === null || value === undefined || value === "") return "-";
        if (field === "amount") return `$${Math.abs(Number(value)).toFixed(2)}`;
        if (field === "categories") return await this.getCategoryNames(String(value));
        if (field === "listingMapId") {
            const listingInfo = await this.listingRepo.findOne({ where: { id: Number(value) } });
            return listingInfo?.internalListingName || String(value);
        }
        if (field === "isRecurring" || field === "llCover") return this.formatBooleanValue(value);
        if (field === "fileNames") return this.formatAttachmentNames(value);
        return String(value);
    }

    private async buildChangeRows(diff: Record<string, { old: any; new: any; }>) {
        const rows = [];
        for (const [field, change] of Object.entries(diff)) {
            if (this.excludedChangeFields.has(field)) continue;

            const label = this.expenseChangeLabels[field];
            if (!label) continue;

            const oldValue = await this.formatChangeValue(field, change.old);
            const newValue = await this.formatChangeValue(field, change.new);
            rows.push(`*${label}:* ~${this.escapeSlackText(oldValue)}~ → ${this.escapeSlackText(newValue)}`);
        }
        return rows;
    }

    private async updateSlackMessage(expense: any, userId: string, eventType: string, diff: Record<string, { old: any; new: any; }> = {}) {
        try {
            const userMap = await getCachedUserMap();

            const listingInfo = await this.listingRepo.findOne({ where: { id: expense.listingMapId } });
            const categoryNames = await this.getCategoryNames(expense.categories);

            const expenseForSlack = await this.resolvePaymentDetailsMentions(expense);
            const changeRows = await this.buildChangeRows(diff);
            let slackMessage: any = buildExpenseSlackMessageUpdate(expenseForSlack as ExpenseEntity, userMap.get(userId), listingInfo?.internalListingName, categoryNames, changeRows);
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "expense",
                    entityId: expense.id
                }
            });
            if (!slackMessageInfo) return;

            if (eventType == "delete") {
                slackMessage = buildExpenseSlackMessageDelete(expenseForSlack as ExpenseEntity, userMap.get(userId), listingInfo?.internalListingName, categoryNames);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            } else if (eventType == "statusUpdate") {
                slackMessage = buildExpenseStatusUpdateMessage(expenseForSlack as ExpenseEntity, userMap.get(userId) || userId, changeRows);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            } else {
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            }

            const mainMessage = buildExpenseSlackMessage(
                expenseForSlack as ExpenseEntity,
                userMap.get(expense.createdBy),
                listingInfo?.internalListingName,
                userMap.get(userId),
                categoryNames,
                { isDeleted: eventType == "delete" }
            );
            const { channel, ...messageWithoutChannel } = mainMessage;
            await updateSlackMessage(messageWithoutChannel, slackMessageInfo.messageTs, slackMessageInfo.channel);

        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<ExpenseEntity>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

        let eventType = "update";
        if ((entity.status != databaseEntity.status)) {
            eventType = "statusUpdate";
        } else if (entity.isDeleted == 1) {
            eventType = "delete";
        }

        await this.updateSlackMessage(entity, entity.updatedBy, eventType, diff);

        if (entity.resolutionId) {
            updateResolutionFromExpense.add('update-resolution-from-expense', { expense: entity });
        }

    }

    async afterRemove(event: RemoveEvent<ExpenseEntity>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
