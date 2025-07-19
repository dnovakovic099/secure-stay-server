import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import { buildIssueUpdateMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { IssueUpdates } from '../entity/IsssueUpdates';
import { appDatabase } from '../utils/database.util';
import { Listing } from '../entity/Listing';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import { UsersEntity } from '../entity/Users';
import logger from '../utils/logger.utils';

@EventSubscriber()
export class IssuesSubscriber
    implements EntitySubscriberInterface<IssueUpdates> {

    listenTo() {
        return IssueUpdates;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<IssueUpdates>) {
        const { entity, manager } = event;
        await this.sendSlackMessage(entity, entity.createdBy);
    }

    private async sendSlackMessage(updates: IssueUpdates, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(updates.issue.listing_id),
                }
            });

            const slackMessage = buildIssueUpdateMessage(updates, listingInfo?.internalListingName, user);
            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "issues",
                    entityId: updates.issue.id
                }
            });

            await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<IssueUpdates>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

    }

    async afterRemove(event: RemoveEvent<IssueUpdates>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };

    }
}
