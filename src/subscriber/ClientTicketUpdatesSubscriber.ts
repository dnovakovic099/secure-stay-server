import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff, replaceMentionsWithSlackIds } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildClientTicketUpdateMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { ClientTicketUpdates } from '../entity/ClientTicketUpdates';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { getSlackUsers } from '../utils/getSlackUsers';

@EventSubscriber()
export class ClientTicketSubscriber
    implements EntitySubscriberInterface<ClientTicketUpdates> {

    listenTo() {
        return ClientTicketUpdates;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<ClientTicketUpdates>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(updates: ClientTicketUpdates, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(updates.clientTicket.listingId),
                }
            });

            // Fetch slack users for mention replacement
            const slackUsers = await getSlackUsers();

            // Process mentions in updates text
            const processedUpdatesText = replaceMentionsWithSlackIds(updates.updates, slackUsers);
            const updatesWithProcessedText = { ...updates, updates: processedUpdatesText };

            const slackMessage = buildClientTicketUpdateMessage(updatesWithProcessedText, listingInfo?.internalListingName, user);
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "client_ticket",
                    entityId: updates.clientTicket.id
                }
            });
            await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<ClientTicketUpdates>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

    }

    async afterRemove(event: RemoveEvent<ClientTicketUpdates>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
