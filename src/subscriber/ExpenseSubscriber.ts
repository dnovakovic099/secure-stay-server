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
            const slackMessage = buildExpenseSlackMessage(expense, user, listingInfo?.internalListingName, undefined, categoryNames);
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

    private async updateSlackMessage(expense: any, userId: string, eventType: string) {
        try {
            const users = await this.usersRepo.find();
            const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

            const listingInfo = await this.listingRepo.findOne({ where: { id: expense.listingMapId } });
            const categoryNames = await this.getCategoryNames(expense.categories);

            let slackMessage = buildExpenseSlackMessageUpdate(expense, userMap.get(userId), listingInfo?.internalListingName, categoryNames);
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "expense",
                    entityId: expense.id
                }
            });
            if (eventType == "delete") {
                slackMessage = buildExpenseSlackMessageDelete(expense, userMap.get(userId), listingInfo?.internalListingName, categoryNames);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            } else if (eventType == "statusUpdate") {
                slackMessage = buildExpenseStatusUpdateMessage(expense, userMap.get(userId) || userId);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            }

            const mainMessage = buildExpenseSlackMessage(expense, userMap.get(expense.createdBy), listingInfo?.internalListingName, userMap.get(userId), categoryNames);
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

        await this.updateSlackMessage(entity, entity.updatedBy, eventType);

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



