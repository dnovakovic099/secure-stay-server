import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildActionItemsSlackMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { ActionItems } from '../entity/ActionItems';
import { ReservationInfoEntity } from '../entity/ReservationInfo';

@EventSubscriber()
export class ActionItemsSubscriber
    implements EntitySubscriberInterface<ActionItems> {

    listenTo() {
        return ActionItems;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationInfoRepo = appDatabase.getRepository(ReservationInfoEntity);

    async afterInsert(event: InsertEvent<ActionItems>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(actionItems: ActionItems, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : userId;

            const reservationInfo = await this.reservationInfoRepo.findOne({ where: { id: actionItems.reservationId } });

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildActionItemsSlackMessage(actionItems, user, reservationInfo);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "action_items",
                entityId: actionItems.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<ActionItems>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

    }

    async afterRemove(event: RemoveEvent<ActionItems>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
