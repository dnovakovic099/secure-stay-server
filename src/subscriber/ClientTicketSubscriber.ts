import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildClientTicketSlackMessage, buildClientTicketSlackMessageDelete, buildClientTicketSlackMessageUpdate, buildIssueSlackMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { ClientTicket } from '../entity/ClientTicket';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';

@EventSubscriber()
export class ClientTicketSubscriber
    implements EntitySubscriberInterface<ClientTicket> {

    listenTo() {
        return ClientTicket;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<ClientTicket>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(ticket: ClientTicket, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(ticket.listingId),
                    userId: userId
                }
            });

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildClientTicketSlackMessage(ticket, user, listingInfo?.internalListingName);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "client_ticket",
                entityId: ticket.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    private async updateSlackMessage(ticket: any, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(ticket.listingId),
                    userId: userId
                }
            });

            let slackMessage = buildClientTicketSlackMessageUpdate(ticket, user, listingInfo?.internalListingName);
            if (ticket.deletedAt) {
                slackMessage = buildClientTicketSlackMessageDelete(ticket, user, listingInfo?.internalListingName);
            }

            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "client_ticket",
                    entityId: ticket.id
                }
            });
            await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<ClientTicket>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;
        await this.updateSlackMessage(entity, entity.updatedBy)

    }

    async afterRemove(event: RemoveEvent<ClientTicket>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
