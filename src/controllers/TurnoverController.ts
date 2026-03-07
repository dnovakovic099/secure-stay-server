import { Request, Response, NextFunction } from "express";
import { TurnoverService } from "../services/TurnoverService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: { id: string; email: string };
}

export class TurnoverController {
    private turnoverService = new TurnoverService();

    /**
     * Get turnover notifications
     */
    async getNotifications(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const filters = {
                search: req.query.search as string,
                notificationType: req.query.notificationType as string,
                status: req.query.status as string,
                propertyType: req.query.propertyType as string,
                fromDate: req.query.fromDate as string,
                toDate: req.query.toDate as string,
                listingId: req.query.listingId ? parseInt(req.query.listingId as string) : undefined,
                date: req.query.date as 'today' | 'tomorrow' | undefined
            };

            const notifications = await this.turnoverService.getNotifications(filters);
            return res.status(200).json({ data: notifications });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get turnover settings
     */
    async getSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const filters = {
                propertyType: req.query.propertyType as string,
                search: req.query.search as string
            };

            const settings = await this.turnoverService.getSettings(filters);
            return res.status(200).json({ data: settings });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update turnover settings for a listing
     */
    async updateSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingId = parseInt(req.params.listingId);
            const data = req.body;
            const userId = req.user?.id;

            const settings = await this.turnoverService.updateSettings(listingId, data, userId);
            return res.status(200).json({ data: settings, message: 'Settings updated successfully' });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get contacts for a listing
     */
    async getContactsForListing(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingId = parseInt(req.params.listingId);
            const contacts = await this.turnoverService.getContactsForListing(listingId);
            return res.status(200).json({ data: contacts });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Sync owners from Hostify
     */
    async syncOwners(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const result = await this.turnoverService.syncOwnersFromHostify();
            return res.status(200).json({ 
                success: true, 
                message: `Synced ${result.synced} owners from Hostify`,
                ...result 
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update notification status (pause/resume/send/skip)
     */
    async updateNotificationStatus(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = parseInt(req.params.reservationId);
            const type = req.params.type as 'pre-stay' | 'post-stay';
            const { action } = req.body;

            // TODO: Implement status update logic
            logger.info(`[TurnoverController] Update notification status: ${reservationId}, ${type}, ${action}`);
            
            return res.status(200).json({ 
                success: true, 
                message: `Notification ${action} successfully` 
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update notification recipient
     */
    async updateNotificationRecipient(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = parseInt(req.params.reservationId);
            const type = req.params.type as 'pre-stay' | 'post-stay';
            const { contactId } = req.body;

            // TODO: Implement recipient update logic
            logger.info(`[TurnoverController] Update recipient: ${reservationId}, ${type}, ${contactId}`);
            
            return res.status(200).json({ 
                success: true, 
                message: 'Recipient updated successfully' 
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Retry failed notification
     */
    async retryNotification(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = parseInt(req.params.reservationId);
            const type = req.params.type as 'pre-stay' | 'post-stay';

            // TODO: Implement retry logic
            logger.info(`[TurnoverController] Retry notification: ${reservationId}, ${type}`);
            
            return res.status(200).json({ 
                success: true, 
                message: 'Notification retry queued' 
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Bulk update settings
     */
    async bulkUpdateSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { updates } = req.body;
            const userId = req.user?.id;

            const results = [];
            for (const update of updates) {
                const result = await this.turnoverService.updateSettings(
                    update.listingId,
                    update.data,
                    userId
                );
                results.push(result);
            }

            return res.status(200).json({ 
                success: true, 
                message: `Updated ${results.length} settings`,
                data: results
            });
        } catch (error) {
            next(error);
        }
    }
}
