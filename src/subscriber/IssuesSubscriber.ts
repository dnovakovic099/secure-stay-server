import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import { Issue } from '../entity/Issue';
import logger from '../utils/logger.utils';
import { buildIssueMessageDelete, buildIssueSlackMessage, buildIssuesSlackMessageUpdate, buildIssueStatusUpdateMessage, buildIssueUpdateMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';
import { appDatabase } from '../utils/database.util';
import { UsersEntity } from '../entity/Users';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';
import updateSlackMessage from '../utils/updateSlackMsg';

@EventSubscriber()
export class IssuesSubscriber
    implements EntitySubscriberInterface<Issue> {

    listenTo() {
        return Issue;
    }

    private usersRepo = appDatabase.getRepository(UsersEntity);
    private slackMessageInfo = appDatabase.getRepository(SlackMessageEntity);

    async afterInsert(event: InsertEvent<Issue>) {
        const { entity, manager } = event;
        // const log = manager.create(IssueLogs, {
        //     issueId: entity.id,
        //     oldData: null,
        //     newData: entity,
        //     diff: Object.keys(entity).reduce((acc, key) => {
        //         acc[key] = { old: null, new: (entity as any)[key] };
        //         return acc;
        //     }, {} as any),
        //     changedBy: entity.created_by || entity.creator || "system",
        //     action: 'INSERT',
        // });
        // await manager.save(log);

        // handle slack message
        try {
            const slackMessage = buildIssueSlackMessage(entity);
            const slackResponse = await sendSlackMessage(slackMessage);
            const slackMessageService = new SlackMessageService();
            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "issues",
                entityId: entity.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterUpdate(event: UpdateEvent<Issue>) {
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

    private async updateSlackMessage(issue: any, userId: string, eventType: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            let slackMessage = buildIssuesSlackMessageUpdate(issue, user);
            if (eventType == "delete") {
                slackMessage = buildIssueMessageDelete(issue, user);
            } else if (eventType == "statusUpdate") {
                slackMessage = buildIssueStatusUpdateMessage(issue, user);
            }

            const slackMessageInfo = await this.slackMessageInfo.findOne({
                where: {
                    entityType: "issues",
                    entityId: issue.id
                }
            });
            await sendSlackMessage(slackMessage, slackMessageInfo.messageTs);
            if (eventType == "statusUpdate") {
                const mainMessage = buildIssueSlackMessage(issue);
                const { channel, ...messageWithoutChannel } = mainMessage;
                await updateSlackMessage(messageWithoutChannel, slackMessageInfo.messageTs, slackMessageInfo.channel);
            }
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
    }

    async afterRemove(event: RemoveEvent<Issue>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
        // const log = manager.create(IssueLogs, {
        //     issueId: oldData.id,
        //     oldData,
        //     newData: null,
        //     diff: Object.keys(oldData).reduce((acc, key) => {
        //         acc[key] = { old: (oldData as any)[key], new: null };
        //         return acc;
        //     }, {} as any),
        //     changedBy: databaseEntity.updated_by || 'system',
        //     action: 'DELETE',
        // });
        // await manager.save(log);
    }
}
