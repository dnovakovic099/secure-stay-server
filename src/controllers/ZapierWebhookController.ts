import { Request, Response } from 'express';
import { ZapierWebhookService, ZapierEventStatus } from '../services/ZapierWebhookService';
import logger from '../utils/logger.utils';

export class ZapierWebhookController {
    private webhookService = new ZapierWebhookService();

    handleWebhook = async (req: Request, res: Response) => {
        try {
            logger.info('[ZapierWebhookController][handleWebhook] Incoming request body:', JSON.stringify(req.body));
            const result = await this.webhookService.processWebhook(req.body);
            return res.status(200).json(result);
        } catch (error) {
            logger.error('[ZapierWebhookController][handleWebhook] Error:', error);
            return res.status(500).json({ 
                status: 'error',
                message: 'Internal server error'
            });
        }
    }

    /**
     * GET /zapier/events - List events with pagination and filters
     */
    getEvents = async (req: Request, res: Response) => {
        try {
            const { status, event, slackChannel, fromDate, toDate, dateType, page, limit } = req.query;

            const result = await this.webhookService.getEvents({
                status: status as string,
                event: event as string,
                slackChannel: slackChannel as string,
                fromDate: fromDate as string,
                toDate: toDate as string,
                dateType: dateType as 'createdAt' | 'updatedAt',
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 10
            });

            return res.status(200).json(result);
        } catch (error) {
            logger.error('[ZapierWebhookController][getEvents] Error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch events'
            });
        }
    };

    /**
     * GET /zapier/events/:id - Get single event by ID
     */
    getEventById = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const event = await this.webhookService.getEventById(id);

            if (!event) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Event not found'
                });
            }

            return res.status(200).json(event);
        } catch (error) {
            logger.error('[ZapierWebhookController][getEventById] Error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch event'
            });
        }
    };

    /**
     * PUT /zapier/events/:id/status - Update event status
     */
    updateEventStatus = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const { status } = req.body;

            // Validate status
            if (!Object.values(ZapierEventStatus).includes(status)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid status. Must be one of: ${Object.values(ZapierEventStatus).join(', ')}`
                });
            }

            const user = (req as any).user;
            const updatedBy = user?.user_metadata?.full_name || user?.email || 'user';

            const event = await this.webhookService.updateEventStatus(id, status, updatedBy);

            return res.status(200).json({
                status: 'success',
                message: 'Status updated successfully',
                data: event
            });
        } catch (error: any) {
            logger.error('[ZapierWebhookController][updateEventStatus] Error:', error);

            if (error.message?.includes('not found')) {
                return res.status(404).json({
                    status: 'error',
                    message: error.message
                });
            }

            return res.status(500).json({
                status: 'error',
                message: 'Failed to update event status'
            });
        }
    };

    /**
     * PUT /zapier/events/bulk-update-status - Bulk update event statuses
     */
    bulkUpdateEventStatus = async (req: Request, res: Response) => {
        try {
            const { ids, status } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'IDs array is required and must not be empty'
                });
            }

            // Validate status
            if (!Object.values(ZapierEventStatus).includes(status)) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid status. Must be one of: ${Object.values(ZapierEventStatus).join(', ')}`
                });
            }

            const user = (req as any).user;
            const updatedBy = user?.user_metadata?.full_name || user?.email || 'user';

            const result = await this.webhookService.bulkUpdateEventStatus(ids, status, updatedBy);

            return res.status(200).json(result);
        } catch (error: any) {
            logger.error('[ZapierWebhookController][bulkUpdateEventStatus] Error:', error);

            if (error.message?.includes('not found')) {
                return res.status(404).json({
                    status: 'error',
                    message: error.message
                });
            }

            return res.status(500).json({
                status: 'error',
                message: 'Failed to bulk update event statuses'
            });
        }
    };

    /**
     * GET /zapier/event-types - Get distinct event types for filter dropdown
     */
    getEventTypes = async (req: Request, res: Response) => {
        try {
            const eventTypes = await this.webhookService.getEventTypes();
            return res.status(200).json(eventTypes);
        } catch (error) {
            logger.error('[ZapierWebhookController][getEventTypes] Error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch event types'
            });
        }
    };

    /**
     * GET /zapier/slack-channels - Get distinct Slack channels for filter dropdown
     */
    getSlackChannels = async (req: Request, res: Response) => {
        try {
            const slackChannels = await this.webhookService.getSlackChannels();
            return res.status(200).json(slackChannels);
        } catch (error) {
            logger.error('[ZapierWebhookController][getSlackChannels] Error:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch slack channels'
            });
        }
    };
}
