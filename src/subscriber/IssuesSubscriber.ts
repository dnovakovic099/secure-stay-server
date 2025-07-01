import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import { Issue } from '../entity/Issue';
import { IssueLogs } from '../entity/IssueLogs';
import logger from '../utils/logger.utils';
import { buildIssueSlackMessage } from '../utils/slackMessageBuilder';
import sendSlackMessage from '../utils/sendSlackMsg';
import { SlackMessageService } from '../services/SlackMessageService';

@EventSubscriber()
export class IssuesSubscriber
    implements EntitySubscriberInterface<Issue> {

    listenTo() {
        return Issue;
    }

    async afterInsert(event: InsertEvent<Issue>) {
        const { entity, manager } = event;
        const log = manager.create(IssueLogs, {
            issueId: entity.id,
            oldData: null,
            newData: entity,
            diff: Object.keys(entity).reduce((acc, key) => {
                acc[key] = { old: null, new: (entity as any)[key] };
                return acc;
            }, {} as any),
            changedBy: entity.created_by || entity.creator || "system",
            action: 'INSERT',
        });
        await manager.save(log);

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

        const log = manager.create(IssueLogs, {
            issueId: entity.id,
            oldData,
            newData,
            diff,
            changedBy: entity?.updated_by || 'system',
            action: 'UPDATE',
        });
        await manager.save(log);
    }

    async afterRemove(event: RemoveEvent<Issue>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
        const log = manager.create(IssueLogs, {
            issueId: oldData.id,
            oldData,
            newData: null,
            diff: Object.keys(oldData).reduce((acc, key) => {
                acc[key] = { old: (oldData as any)[key], new: null };
                return acc;
            }, {} as any),
            changedBy: databaseEntity.updated_by || 'system',
            action: 'DELETE',
        });
        await manager.save(log);
    }
}
