import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { In, Brackets } from 'typeorm';
import { EmailProcessor } from '../utils/emailProcessor.util';
import sendSlackMessage from '../utils/sendSlackMsg';
import updateSlackMessage from '../utils/updateSlackMsg';
import { SlackMessageService } from './SlackMessageService';
import { AIEscalationManagerService } from './AIEscalationManagerService';
import { buildZapierEventSlackMessage, buildZapierEventStatusUpdateMessage, buildZapierStatusChangeThreadMessage } from '../utils/slackMessageBuilder';
import { SlackMessageEntity } from '../entity/SlackMessageInfo';

/**
 * Enum for Zapier trigger event status
 */
export enum ZapierEventStatus {
    New = 'New',
    InProgress = 'In Progress',
    Completed = 'Completed'
}

const ARCHIVED_GR_TASK_CHANNELS = ['airbnb-support'];

export interface ZapierEventStatusHistoryRow {
    id: number;
    eventId: number;
    previousStatus: string | null;
    status: string;
    changedBy: string | null;
    changedAt: Date;
    createdAt: Date;
}

export class ZapierWebhookService {
    private slackMessageService = new SlackMessageService();
    private aiManager = new AIEscalationManagerService();

    async processWebhook(payload: any): Promise<{ status: string; message: string; eventId?: number; }> {
        logger.info(`[ZapierWebhookService][processWebhook] Received payload: ${JSON.stringify(payload)}`);
        
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);

        // Process email content if present
        const processedContent = EmailProcessor.process(payload.email_body_html, payload.email_body_plain);

        // Create new event record
        const event = new ZapierTriggerEvent();
        event.status = ZapierEventStatus.New;
        event.event = payload.event || 'unknown';
        event.botName = payload.bot_name || '';
        event.botIcon = payload.bot_icon || null;
        event.title = payload.title || null;
        event.message = payload.message || '';
        event.slackChannel = payload.slack_channel || null;
        event.emailSubject = payload.email_subject || null;
        event.emailBodyPlain = payload.email_body_plain || null;
        event.emailBodyHtml = payload.email_body_html || null;
        event.processedMessage = processedContent || null;
        event.rawPayload = JSON.stringify(payload);
        event.createdBy = 'zapier_webhook';

        try {
            // Save the initial event record
            await eventRepo.save(event);
            await this.recordStatusHistory(event.id, null, ZapierEventStatus.New, event.createdBy, event.createdAt);
            logger.info(`[ZapierWebhookService][processWebhook] Created event record with ID: ${event.id}`);

            // Send Slack notifications (main message + threaded reply)
            const slackInfo = await this.sendSlackNotifications(event);

            // Save Slack info to the event (if columns exist in DB)
            // Note: These columns need to be added via migration:
            // ALTER TABLE zapier_trigger_events 
            //   ADD COLUMN slack_channel_id VARCHAR(50) NULL,
            //   ADD COLUMN slack_thread_ts VARCHAR(50) NULL,
            //   ADD COLUMN slack_permalink VARCHAR(500) NULL;
            try {
                if (slackInfo.channelId) {
                    event.slackChannelId = slackInfo.channelId;
                }
                if (slackInfo.messageTs) {
                    event.slackThreadTs = slackInfo.messageTs;
                }
                if (slackInfo.permalink) {
                    event.slackPermalink = slackInfo.permalink;
                }
            } catch (slackInfoError) {
                logger.warn(`[ZapierWebhookService][processWebhook] Could not save Slack info (columns may not exist): ${slackInfoError}`);
            }

            // Note: Status remains as 'New', user will manually update to 'In Progress' or 'Completed'
            event.updatedBy = 'zapier_webhook';
            await eventRepo.save(event);

            logger.info(`[ZapierWebhookService][processWebhook] Successfully processed event ID: ${event.id}`);

            return {
                status: 'success',
                message: 'Webhook received and stored successfully',
                eventId: event.id
            };
        } catch (error) {
            logger.error(`[ZapierWebhookService][processWebhook] Error processing event: ${error}`);

            // Keep status as 'New' even on error, but record the error
            // event.status = 'failed';
            event.errorMessage = error instanceof Error ? error.message : String(error);
            event.updatedBy = 'zapier_webhook';

            try {
                await eventRepo.save(event);
            } catch (saveError) {
                logger.error(`[ZapierWebhookService][processWebhook] Failed to save error status: ${saveError}`);
            }

            throw error;
        }
    }

    /**
     * Send Slack notifications for a Zapier event
     * Returns Slack info (channelId, messageTs, permalink) for saving to the event
     */
    private async sendSlackNotifications(event: ZapierTriggerEvent): Promise<{channelId?: string; messageTs?: string; permalink?: string}> {
        try {
            // 1. Build and send the main interactive message
            const slackMessage = buildZapierEventSlackMessage(event);

            // Add SecureStay task link to the message
            const securestayTaskUrl = `https://app.securestay.ai/messages/gr-tasks?taskId=${event.id}`;
            if (slackMessage.text) {
                slackMessage.text += `\n\n📋 <${securestayTaskUrl}|View in SecureStay>`;
            }

            // Ensure channel starts with # if it's a name and not an ID (IDs start with C, D, or G)
            if (slackMessage.channel && !slackMessage.channel.startsWith('#') && !/^[C|D|G][A-Z0-9]{8,10}$/.test(slackMessage.channel)) {
                slackMessage.channel = `#${slackMessage.channel}`;
            }

            const result = await sendSlackMessage(slackMessage);

            if (result && result.ok) {
                const messageTs = result.ts;
                const channelId = result.channel;

                // 2. Save tracking info to SlackMessageEntity
                await this.slackMessageService.saveSlackMessageInfo({
                    channel: channelId,
                    messageTs: messageTs,
                    threadTs: messageTs, // It's a root message
                    entityType: 'zapier_trigger_event',
                    entityId: event.id,
                    originalMessage: JSON.stringify(slackMessage)
                });

                // 3. If there is processed email content, send it as a threaded reply
                if (event.processedMessage) {
                    await sendSlackMessage({
                        channel: channelId,
                        text: event.processedMessage,
                        bot_name: event.botName,
                        bot_icon: event.botIcon,
                    }, messageTs);
                }

                // 4. Construct permalink (format: https://workspace.slack.com/archives/{channel}/p{ts_without_dot})
                const tsWithoutDot = messageTs.replace('.', '');
                const permalink = `${process.env.SLACK_WORKSPACE_URL}archives/${channelId}/p${tsWithoutDot}`;

                return { channelId, messageTs, permalink };
            } else {
                logger.error(`[ZapierWebhookService][sendSlackNotifications] Failed to send Slack message: ${JSON.stringify(result)}`);
                return {};
            }
        } catch (error) {
            logger.error(`[ZapierWebhookService][sendSlackNotifications] Error: ${error}`);
            return {};
        }
    }

    /**
     * Get Zapier events with filtering and pagination
     */
    async getEvents(filters: {
        status?: string;
        statuses?: string[];
        events?: string[];
        slackChannels?: string[];
        fromDate?: string;
        toDate?: string;
        dateType?: 'createdAt' | 'updatedAt';
        search?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: ZapierTriggerEvent[];
        meta: { page: number; limit: number; total: number; };
    }> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const skip = (page - 1) * limit;

        const queryBuilder = eventRepo.createQueryBuilder('event');

        queryBuilder.andWhere(
            new Brackets(qb => {
                qb.where('event.slackChannel IS NULL')
                    .orWhere('LOWER(REPLACE(event.slackChannel, "#", "")) NOT IN (:...archivedChannels)', {
                        archivedChannels: ARCHIVED_GR_TASK_CHANNELS,
                    });
            })
        );

        // Filter by status (multi-select takes precedence over single)
        if (filters.statuses && filters.statuses.length > 0) {
            queryBuilder.andWhere('event.status IN (:...statuses)', { statuses: filters.statuses });
        } else if (filters.status) {
            queryBuilder.andWhere('event.status = :status', { status: filters.status });
        }

        // Filter by event types (multi-select)
        if (filters.events && filters.events.length > 0) {
            queryBuilder.andWhere('event.event IN (:...eventTypes)', { eventTypes: filters.events });
        }

        // Filter by Slack channels (multi-select)
        if (filters.slackChannels && filters.slackChannels.length > 0) {
            queryBuilder.andWhere('event.slackChannel IN (:...slackChannels)', { slackChannels: filters.slackChannels });
        }

        // Filter by date range
        const dateField = filters.dateType === 'updatedAt' ? 'event.updatedAt' : 'event.createdAt';
        if (filters.fromDate) {
            // If datetime format (includes space/T), use as-is; otherwise append 00:00:00
            const fromDateTime = filters.fromDate.includes(' ') || filters.fromDate.includes('T') 
                ? filters.fromDate 
                : `${filters.fromDate} 00:00:00`;
            queryBuilder.andWhere(`${dateField} >= :fromDate`, { fromDate: fromDateTime });
        }
        if (filters.toDate) {
            // If datetime format, use as-is; otherwise append 23:59:59
            const toDateTime = filters.toDate.includes(' ') || filters.toDate.includes('T')
                ? filters.toDate
                : `${filters.toDate} 23:59:59`;
            queryBuilder.andWhere(`${dateField} <= :toDate`, { toDate: toDateTime });
        }

        // Search across task fields + thread messages (updates/discussions)
        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            // Use LEFT JOIN to include thread_messages in the search
            queryBuilder.leftJoin('thread_messages', 'tm', 'tm.gr_task_id = event.id');
            queryBuilder.andWhere(
                new Brackets(qb => {
                    qb.where('event.title LIKE :searchTerm', { searchTerm })
                        .orWhere('event.message LIKE :searchTerm', { searchTerm })
                        .orWhere('event.event LIKE :searchTerm', { searchTerm })
                        .orWhere('event.slackChannel LIKE :searchTerm', { searchTerm })
                        .orWhere('event.emailSubject LIKE :searchTerm', { searchTerm })
                        .orWhere('event.emailBodyPlain LIKE :searchTerm', { searchTerm })
                        .orWhere('tm.content LIKE :searchTerm', { searchTerm });
                })
            );
            // Use DISTINCT to avoid duplicates from multiple thread message matches
            queryBuilder.distinct(true);
        }

        // Add count logic for user vs system inputs
        // User inputs: thread messages where source='slack' or (source='securestay' AND userName IS NULL/NOT 'AI Manager' etc if configured, normally source='securestay' could be either. We defined system inputs as Securestay internal/AI manager)
        // Since we explicitly want system = AI/Securestay Activity excluding status updates.
        // And user = messages from Slack or direct updates.
        // We'll count thread_messages with source='slack' OR source='securestay' as userInputCount.
        // We'll count ai_escalation_logs as systemInputCount.

        queryBuilder.addSelect(
            `(SELECT COUNT(*) FROM thread_messages tm WHERE tm.gr_task_id = event.id AND (tm.source = 'slack' OR tm.source = 'securestay'))`,
            'userInputCount'
        );

        queryBuilder.addSelect(
            `(SELECT COUNT(*) FROM ai_escalation_logs aiel WHERE aiel.task_id = event.id)`,
            'systemInputCount'
        );

        // Get total count
        const total = await queryBuilder.getCount();

        // Get paginated results along with the raw calculated counts
        // Because getMany() doesn't include raw counts from addSelect directly to the entity unless properties exist,
        // we use getRawAndEntities()
        const { entities, raw } = await queryBuilder
            .orderBy('event.createdAt', 'DESC')
            .skip(skip)
            .take(limit)
            .getRawAndEntities();

        // Process raw counts back into the entities
        const data = entities.map(entity => {
            const rawItem = raw.find(r => r.event_id === entity.id);
            return {
                ...entity,
                userInputCount: rawItem ? parseInt(rawItem.userInputCount || '0') : 0,
                systemInputCount: rawItem ? parseInt(rawItem.systemInputCount || '0') : 0
            };
        });

        return {
            data: data as any,
            meta: { page, limit, total }
        };
    }

    async getActivityData(filters: {
        events?: string[];
        slackChannels?: string[];
        search?: string;
    }): Promise<{
        data: {
            tasks: Array<ZapierTriggerEvent & { userInputCount: number; systemInputCount: number }>;
            statusHistory: ZapierEventStatusHistoryRow[];
        };
    }> {
        await this.ensureStatusHistoryTable();

        const [currentResult, logBackedTasks] = await Promise.all([
            this.getEvents({
                events: filters.events,
                slackChannels: filters.slackChannels,
                search: filters.search,
                page: 1,
                limit: 100000,
            }),
            this.getActivityTasksFromStatusLogs(filters),
        ]);

        const taskById = new Map<number, ZapierTriggerEvent & { userInputCount: number; systemInputCount: number }>();
        [...logBackedTasks, ...currentResult.data].forEach((task: any) => {
            taskById.set(task.id, task);
        });

        const tasks = Array.from(taskById.values())
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const taskIds = tasks.map((task) => task.id);
        const statusHistory = taskIds.length ? await this.getStatusHistoryForEvents(taskIds) : [];

        return {
            data: {
                tasks: tasks as any,
                statusHistory,
            },
        };
    }

    private async getActivityTasksFromStatusLogs(filters: {
        events?: string[];
        slackChannels?: string[];
        search?: string;
    }): Promise<Array<ZapierTriggerEvent & { userInputCount: number; systemInputCount: number }>> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const queryBuilder = eventRepo
            .createQueryBuilder('event')
            .innerJoin('zapier_trigger_event_status_history', 'statusLog', 'statusLog.event_id = event.id')
            .distinct(true);

        queryBuilder.andWhere(
            new Brackets(qb => {
                qb.where('event.slackChannel IS NULL')
                    .orWhere('LOWER(REPLACE(event.slackChannel, "#", "")) NOT IN (:...archivedChannels)', {
                        archivedChannels: ARCHIVED_GR_TASK_CHANNELS,
                    });
            })
        );

        if (filters.events && filters.events.length > 0) {
            queryBuilder.andWhere('event.event IN (:...eventTypes)', { eventTypes: filters.events });
        }

        if (filters.slackChannels && filters.slackChannels.length > 0) {
            queryBuilder.andWhere('event.slackChannel IN (:...slackChannels)', { slackChannels: filters.slackChannels });
        }

        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            queryBuilder.leftJoin('thread_messages', 'tm', 'tm.gr_task_id = event.id');
            queryBuilder.andWhere(
                new Brackets(qb => {
                    qb.where('event.title LIKE :searchTerm', { searchTerm })
                        .orWhere('event.message LIKE :searchTerm', { searchTerm })
                        .orWhere('event.event LIKE :searchTerm', { searchTerm })
                        .orWhere('event.slackChannel LIKE :searchTerm', { searchTerm })
                        .orWhere('event.emailSubject LIKE :searchTerm', { searchTerm })
                        .orWhere('event.emailBodyPlain LIKE :searchTerm', { searchTerm })
                        .orWhere('tm.content LIKE :searchTerm', { searchTerm });
                })
            );
        }

        queryBuilder.addSelect(
            `(SELECT COUNT(*) FROM thread_messages tm WHERE tm.gr_task_id = event.id AND (tm.source = 'slack' OR tm.source = 'securestay'))`,
            'userInputCount'
        );

        queryBuilder.addSelect(
            `(SELECT COUNT(*) FROM ai_escalation_logs aiel WHERE aiel.task_id = event.id)`,
            'systemInputCount'
        );

        const { entities, raw } = await queryBuilder
            .orderBy('event.createdAt', 'DESC')
            .take(100000)
            .getRawAndEntities();

        return entities.map(entity => {
            const rawItem = raw.find(r => r.event_id === entity.id);
            return {
                ...entity,
                userInputCount: rawItem ? parseInt(rawItem.userInputCount || '0') : 0,
                systemInputCount: rawItem ? parseInt(rawItem.systemInputCount || '0') : 0
            };
        }) as any;
    }

    private async ensureStatusHistoryTable() {
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS zapier_trigger_event_status_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_id INT NOT NULL,
                previous_status VARCHAR(50) NULL,
                status VARCHAR(50) NOT NULL,
                changed_by VARCHAR(255) NULL,
                changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ztesh_event_changed (event_id, changed_at),
                INDEX idx_ztesh_status_changed (status, changed_at),
                CONSTRAINT fk_ztesh_event
                    FOREIGN KEY (event_id)
                    REFERENCES zapier_trigger_events(id)
                    ON DELETE CASCADE
            )
        `);
    }

    private async recordStatusHistory(
        eventId: number,
        previousStatus: string | null,
        status: string,
        changedBy?: string | null,
        changedAt: Date = new Date()
    ) {
        if (previousStatus === status) return;
        await this.ensureStatusHistoryTable();
        await appDatabase.query(
            `INSERT INTO zapier_trigger_event_status_history
                (event_id, previous_status, status, changed_by, changed_at)
             VALUES (?, ?, ?, ?, ?)`,
            [eventId, previousStatus, status, changedBy || null, changedAt]
        );
    }

    private async getStatusHistoryForEvents(eventIds: number[]): Promise<ZapierEventStatusHistoryRow[]> {
        await this.ensureStatusHistoryTable();
        const rows = await appDatabase.query(
            `SELECT
                id,
                event_id AS eventId,
                previous_status AS previousStatus,
                status,
                changed_by AS changedBy,
                changed_at AS changedAt,
                created_at AS createdAt
             FROM zapier_trigger_event_status_history
             WHERE event_id IN (?)
             ORDER BY changed_at ASC, id ASC`,
            [eventIds]
        );
        return rows;
    }

    /**
     * Update event status
     */
    async updateEventStatus(id: number, status: ZapierEventStatus, updatedBy?: string): Promise<ZapierTriggerEvent> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);

        const event = await eventRepo.findOne({ where: { id } });
        if (!event) {
            throw new Error(`Event with ID ${id} not found`);
        }

        const previousStatus = event.status;
        const changedAt = new Date();
        event.status = status;
        event.updatedBy = updatedBy || 'user';

        // Set completedOn if status is Completed
        if (status === ZapierEventStatus.Completed) {
            event.completedOn = new Date();
            event.isOverdue = false;
            event.reminderCount = 0;
            event.escalationLevel = 0;
        }

        // Stop overdue reminders when moving to In Progress
        if (status === ZapierEventStatus.InProgress) {
            event.isOverdue = false;
            event.reminderCount = 0;
            event.escalationLevel = 0;
        }

        await eventRepo.save(event);
        await this.recordStatusHistory(event.id, previousStatus, status, event.updatedBy, changedAt);
        logger.info(`[ZapierWebhookService][updateEventStatus] Updated event ${id} to status: ${status}`);

        // Notify Slack about the status change
        // We run this asynchronously to not block the API response
        this.notifySlackStatusChange(event, event.updatedBy).catch(err => {
            logger.error(`[ZapierWebhookService][updateEventStatus] Slack notification failed: ${err}`);
        });

        // Send completion message if status changed to Completed
        if (status === ZapierEventStatus.Completed && previousStatus !== ZapierEventStatus.Completed) {
            this.sendCompletionMessage(event).catch(err => {
                logger.error(`[ZapierWebhookService][updateEventStatus] Completion message failed: ${err}`);
            });
        }

        return event;
    }

    /**
     * Send completion review message to Slack thread.
     * Uses AI to evaluate completion quality:
     *   - Strong completion → optional praise (if reinforcement enabled)
     *   - Weak/missing detail → ask for resolution note
     *   - Escalation flag → tag manager for bad completion
     * Suppresses generic/useless messages.
     */
    private async sendCompletionMessage(event: ZapierTriggerEvent) {
        try {
            const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
            const slackMsg = await slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: event.id }
            });

            if (!slackMsg) {
                logger.warn(`[ZapierWebhookService][sendCompletionMessage] No Slack thread record for event ${event.id} — skipping`);
                return;
            }

            const review = await this.aiManager.reviewCompletion(event.id);

            if (!review) {
                logger.info(`[ZapierWebhookService][sendCompletionMessage] Completion review disabled for event ${event.id}`);
                return;
            }

            if (!review.shouldSendMessage) {
                logger.info(`[ZapierWebhookService][sendCompletionMessage] Suppressed non-useful completion message for event ${event.id} (quality=${review.completionQuality.toFixed(2)})`);
            } else {
                // Build full message: optional manager mention + body
                const parts: string[] = [];
                if (review.managerMention) parts.push(review.managerMention);
                if (review.message) parts.push(review.message);
                const fullMessage = parts.join(' ').trim();

                if (fullMessage) {
                    await sendSlackMessage({ channel: slackMsg.channel, text: fullMessage }, slackMsg.messageTs);
                    logger.info(`[ZapierWebhookService][sendCompletionMessage] Sent completion review for event ${event.id} (quality=${review.completionQuality.toFixed(2)}, escalate=${review.escalateToManager})`);
                }
            }

            // Always persist the AI review result
            event.completionQualityScore = review.completionQuality;
            event.lastAiReviewSummary = review.reasoningSummary;
            event.lastAiReviewAt = new Date();
            await appDatabase.getRepository(ZapierTriggerEvent).save(event);

        } catch (error) {
            logger.error(`[ZapierWebhookService][sendCompletionMessage] Error: ${error}`);
        }
    }

    /**
     * Bulk update event status for multiple events
     */
    async bulkUpdateEventStatus(ids: number[], status: ZapierEventStatus, updatedBy: string): Promise<{ success: boolean; updatedCount: number; message: string; }> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);

        const events = await eventRepo.find({ where: { id: In(ids) } });

        if (events.length !== ids.length) {
            const foundIds = events.map(e => e.id);
            const missingIds = ids.filter(id => !foundIds.includes(id));
            throw new Error(`Events with IDs ${missingIds.join(', ')} not found`);
        }

        const changedAt = new Date();
        const updatePromises = events.map(async event => {
            const previousStatus = event.status;
            event.status = status;
            event.updatedBy = updatedBy;

            if (status === ZapierEventStatus.Completed) {
                event.completedOn = new Date();
                event.isOverdue = false;
                event.reminderCount = 0;
                event.escalationLevel = 0;
            }

            if (status === ZapierEventStatus.InProgress) {
                event.isOverdue = false;
                event.reminderCount = 0;
                event.escalationLevel = 0;
            }

            const savedEvent = await eventRepo.save(event);
            await this.recordStatusHistory(event.id, previousStatus, status, updatedBy, changedAt);
            return savedEvent;
        });

        const updatedEvents = await Promise.all(updatePromises);

        logger.info(`[ZapierWebhookService][bulkUpdateEventStatus] Updated ${updatedEvents.length} events to status: ${status}`);

        // Notify Slack asynchronously for each event
        updatedEvents.forEach(event => {
            this.notifySlackStatusChange(event, updatedBy).catch(err => {
                logger.error(`[ZapierWebhookService][bulkUpdateEventStatus] Slack notification failed for event ${event.id}: ${err}`);
            });
        });

        return {
            success: true,
            updatedCount: updatedEvents.length,
            message: `Successfully updated ${updatedEvents.length} events`
        };
    }

    /**
     * Bulk delete events for selected GR tasks.
     */
    async bulkDeleteEvents(ids: number[]): Promise<{ success: boolean; deletedCount: number; message: string; }> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const events = await eventRepo.find({ where: { id: In(ids) } });

        if (events.length !== ids.length) {
            const foundIds = events.map(e => e.id);
            const missingIds = ids.filter(id => !foundIds.includes(id));
            throw new Error(`Events with IDs ${missingIds.join(', ')} not found`);
        }

        await eventRepo.delete({ id: In(ids) });

        logger.info(`[ZapierWebhookService][bulkDeleteEvents] Deleted ${events.length} events`);

        return {
            success: true,
            deletedCount: events.length,
            message: `Successfully deleted ${events.length} events`
        };
    }

    /**
     * Notify Slack about a status change (update original message + threaded reply)
     */
    private async notifySlackStatusChange(event: ZapierTriggerEvent, user: string) {
        try {
            // 1. Get Slack message tracking info
            const slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
            const slackMsg = await slackMessageRepo.findOne({
                where: { entityType: 'zapier_trigger_event', entityId: event.id }
            });

            if (slackMsg) {
                // 2. Update the original message (to show new status and keep the dropdown)
                const updatePayload = buildZapierEventStatusUpdateMessage(event, user);
                await updateSlackMessage(updatePayload, slackMsg.messageTs, slackMsg.channel);

                // 3. Send threaded reply for the change log
                const threadPayload = buildZapierStatusChangeThreadMessage(event, user);
                await sendSlackMessage({
                    channel: slackMsg.channel,
                    ...threadPayload,
                }, slackMsg.messageTs);

                logger.info(`[ZapierWebhookService][notifySlackStatusChange] Slack updated for event ${event.id}`);
            }
        } catch (error) {
            logger.error(`[ZapierWebhookService][notifySlackStatusChange] Error: ${error}`);
        }
    }

    /**
     * Get single event by ID
     */
    async getEventById(id: number): Promise<ZapierTriggerEvent | null> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        return eventRepo.findOne({ where: { id } });
    }

    /**
     * Get distinct event types for filter dropdown
     */
    async getEventTypes(): Promise<string[]> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const result = await eventRepo
            .createQueryBuilder('event')
            .select('DISTINCT event.event', 'eventType')
            .getRawMany();
        return result.map(r => r.eventType);
    }

    /**
     * Get distinct Slack channels for filter dropdown
     */
    async getSlackChannels(): Promise<string[]> {
        const eventRepo = appDatabase.getRepository(ZapierTriggerEvent);
        const result = await eventRepo
            .createQueryBuilder('event')
            .select('DISTINCT event.slackChannel', 'slackChannel')
            .where('event.slackChannel IS NOT NULL')
            .andWhere('event.slackChannel != :empty', { empty: '' })
            .andWhere('LOWER(REPLACE(event.slackChannel, "#", "")) NOT IN (:...archivedChannels)', {
                archivedChannels: ARCHIVED_GR_TASK_CHANNELS,
            })
            .getRawMany();
        return result.map(r => r.slackChannel).filter(Boolean);
    }
}
