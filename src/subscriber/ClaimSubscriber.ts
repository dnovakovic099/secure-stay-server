import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import logger from '../utils/logger.utils';
import { buildClaimSlackMessage, buildClaimSlackMessageDelete, buildClaimStatusUpdateMessage, buildClientTicketSlackMessageDelete, buildClientTicketSlackMessageUpdate, buildIssueSlackMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { ClientTicket } from '../entity/ClientTicket';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { Listing } from '../entity/Listing';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { Claim } from '../entity/Claim';
import updateSlackMessage from '../utils/updateSlackMsg';

@EventSubscriber()
export class ClientTicketSubscriber
    implements EntitySubscriberInterface<Claim> {

    listenTo() {
        return Claim;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<Claim>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.created_by);
    }

    private async sendSlackMessage(claim: Claim, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildClaimSlackMessage(claim, user);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "claim",
                entityId: claim.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    private async updateSlackMessage(claim: any, userId: string, eventType: string) {
        try {
            const users = await this.usersRepo.find();
            const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

            let slackMessage = buildClaimSlackMessage(claim, userMap.get(userId));
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "claim",
                    entityId: claim.id
                }
            });
            if (eventType == "delete") {
                slackMessage = buildClaimSlackMessageDelete(claim, userMap.get(userId));
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            } else if (eventType == "statusUpdate") {
                slackMessage = buildClaimStatusUpdateMessage(claim, userMap.get(userId) || userId);
                await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            }

            const mainMessage = buildClaimSlackMessage(claim, userMap.get(claim.created_by), userMap.get(userId));
            const { channel, ...messageWithoutChannel } = mainMessage;
            await updateSlackMessage(messageWithoutChannel, slackMessageInfo.messageTs, slackMessageInfo.channel);

        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<Claim>) {
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
        } else if (entity.deleted_at) {
            eventType = "delete";
        }

        await this.updateSlackMessage(entity, entity.updated_by, eventType)

    }

    async afterRemove(event: RemoveEvent<Claim>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}
