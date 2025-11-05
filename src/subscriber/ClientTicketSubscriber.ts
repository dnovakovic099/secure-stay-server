import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { clientTicketMentions, getDiff, setSelectedSlackUsers } from '../helpers/helpers';
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
                }
            });

            const categories = JSON.parse(ticket.category);
            let mentions = [];
            categories.map((category: any) => {
                mentions = [...mentions, ...clientTicketMentions(category),];
            });

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildClientTicketSlackMessage(ticket, user, listingInfo?.internalListingName, mentions);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "client_ticket",
                entityId: ticket.id,
                originalMessage: JSON.stringify(slackMessage)
            });

            //reset selected mentions
            setSelectedSlackUsers([]);
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    private async updateSlackMessage(ticket: any, userId: string, diff: any) {
        try {
            const userList = await this.usersRepo.find();
            const userInfo = userList.find(user => user.uid == userId);
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(ticket.listingId),
                }
            });

            // ---- 🧠 Preprocess diff ----
            const processedDiff: Record<string, { old: any; new: any; }> = {};

            Object.entries(diff).forEach(([key, value]: [string, any]) => {
                // Skip metadata fields
                const excludedFields = [
                    "createdBy", "updatedBy", "updatedAt",
                    "createdAt", "deletedAt", "deletedBy"
                ];
                if (excludedFields.includes(key)) return;

                // If assignee, map UIDs to full names
                if (key === "assignee") {
                    const oldUser = userList.find(u => u.uid === value.old);
                    const newUser = userList.find(u => u.uid === value.new);
                    processedDiff[key] = {
                        old: oldUser ? `${oldUser.firstName} ${oldUser.lastName}` : value.old,
                        new: newUser ? `${newUser.firstName} ${newUser.lastName}` : value.new
                    };
                } else {
                    processedDiff[key] = value;
                }
            });

            let slackMessage = buildClientTicketSlackMessageUpdate(processedDiff, user, listingInfo?.internalListingName);
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
        await this.updateSlackMessage(entity, entity.updatedBy, diff)

    }

    async afterRemove(event: RemoveEvent<ClientTicket>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
