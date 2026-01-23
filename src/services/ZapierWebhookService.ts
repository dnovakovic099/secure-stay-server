import logger from '../utils/logger.utils';
import { appDatabase } from '../utils/database.util';
import { ZapierTriggerEvent } from '../entity/ZapierTriggerEvent';
import { EmailProcessor } from '../utils/emailProcessor.util';

/**
 * Enum for Zapier trigger event status
 */
export enum ZapierEventStatus {
    New = 'New',
    InProgress = 'In Progress',
    Completed = 'Completed'
}

export class ZapierWebhookService {
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

            // TODO: Add event-specific processing here based on event.event type
            // Example:
            // switch (event.event) {
            //     case 'low_battery':
            //         await this.handleLowBattery(event, payload);
            //         break;
            //     case 'pending_reservation':
            //         await this.handlePendingReservation(event, payload);
            //         break;
            //     case 'reservation_change':
            //         await this.handleReservationChange(event, payload);
            //         break;
            //     case 'bdc_listing_question':
            //         await this.handleBdcListingQuestion(event, payload);
            //         break;
            // }

            // Note: Status remains as 'New', user will manually update to 'In Progress' or 'Completed'
            // event.status = ZapierEventStatus.Completed;
            // event.completedOn = new Date();
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
     * Get Zapier events with filtering and pagination
     */
    async getEvents(filters: {
        status?: string;
        event?: string;
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

        return event;
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
}
