import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildActionItemsUpdateMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';

import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { ActionItemsUpdates } from '../entity/ActionItemsUpdates';

@EventSubscriber()
export class ClientTicketSubscriber
    implements EntitySubscriberInterface<ActionItemsUpdates> {

    listenTo() {
        return ActionItemsUpdates;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<ActionItemsUpdates>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(updates: ActionItemsUpdates, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(updates.actionItems.listingId),
                }
            });

            const slackMessage = buildActionItemsUpdateMessage(updates, listingInfo?.internalListingName, user);
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "action_items",
                    entityId: updates.actionItems.id
                }
            });
            await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<ActionItemsUpdates>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

    }

    async afterRemove(event: RemoveEvent<ActionItemsUpdates>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
