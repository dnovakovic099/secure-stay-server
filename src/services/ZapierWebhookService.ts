import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { In } from 'typeorm';
import { EmailProcessor } from '../utils/emailProcessor.util';
import sendSlackMessage from '../utils/sendSlackMsg';
import updateSlackMessage from '../utils/updateSlackMsg';
import { SlackMessageService } from './SlackMessageService';
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

export class ZapierWebhookService {
    private slackMessageService = new SlackMessageService();

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
                const permalink = `https://luxurylodging.slack.com/archives/${channelId}/p${tsWithoutDot}`;

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
        event?: string;
        slackChannel?: string;
        fromDate?: string;
        toDate?: string;
        dateType?: 'createdAt' | 'updatedAt';
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

        // Filter by status
        if (filters.status) {
            queryBuilder.andWhere('event.status = :status', { status: filters.status });
        }

        // Filter by event type
        if (filters.event) {
            queryBuilder.andWhere('event.event = :eventType', { eventType: filters.event });
        }

        // Filter by Slack channel
        if (filters.slackChannel) {
            queryBuilder.andWhere('event.slackChannel = :slackChannel', { slackChannel: filters.slackChannel });
        }

        // Filter by date range
        const dateField = filters.dateType === 'updatedAt' ? 'event.updatedAt' : 'event.createdAt';
        if (filters.fromDate) {
            queryBuilder.andWhere(`${dateField} >= :fromDate`, { fromDate: filters.fromDate });
        }
        if (filters.toDate) {
            queryBuilder.andWhere(`${dateField} <= :toDate`, { toDate: `${filters.toDate} 23:59:59` });
        }

        // Get total count
        const total = await queryBuilder.getCount();

        // Get paginated results
        const data = await queryBuilder
            .orderBy('event.createdAt', 'DESC')
            .skip(skip)
            .take(limit)
            .getMany();

        return {
            data,
            meta: { page, limit, total }
        };
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

        event.status = status;
        event.updatedBy = updatedBy || 'user';

        // Set completedOn if status is Completed
        if (status === ZapierEventStatus.Completed) {
            event.completedOn = new Date();
        }

        await eventRepo.save(event);
        logger.info(`[ZapierWebhookService][updateEventStatus] Updated event ${id} to status: ${status}`);

        // Notify Slack about the status change
        // We run this asynchronously to not block the API response
        this.notifySlackStatusChange(event, event.updatedBy).catch(err => {
            logger.error(`[ZapierWebhookService][updateEventStatus] Slack notification failed: ${err}`);
        });

        return event;
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

        const updatePromises = events.map(event => {
            event.status = status;
            event.updatedBy = updatedBy;

            if (status === ZapierEventStatus.Completed) {
                event.completedOn = new Date();
            }

            return eventRepo.save(event);
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
            .getRawMany();
        return result.map(r => r.slackChannel).filter(Boolean);
    }
}
