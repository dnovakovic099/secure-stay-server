import { Request, Response, NextFunction } from "express";
import { TurnoverService } from "../services/TurnoverService";
import { CheckInNotificationService } from "../services/CheckInNotificationService";
import { CleanerNotificationService } from "../services/CleanerNotificationService";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: { id: string; email: string };
}

export class TurnoverController {
    private turnoverService = new TurnoverService();
    private checkInNotificationService = new CheckInNotificationService();
    private cleanerNotificationService = new CleanerNotificationService();

    /**
     * Get turnover notifications
     */
    async getNotifications(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const dateRange = req.query.dateRange;
            const fromDate = (Array.isArray(dateRange) ? dateRange[0] : req.query.fromDate) as string;
            const toDate = (Array.isArray(dateRange) ? dateRange[1] : req.query.toDate) as string;

            const parseList = (value?: string | string[]) => {
                if (!value) return undefined;
                if (Array.isArray(value)) return value;
                return value.split(',').map((v) => v.trim()).filter(Boolean);
            };

            const filters = {
                search: req.query.search as string,
                notificationType: parseList(req.query.notificationType as string | string[]),
                status: parseList(req.query.status as string | string[]),
                propertyType: parseList(req.query.propertyType as string | string[]),
                fromDate,
                toDate,
                dateField: req.query.dateField as 'checkIn' | 'checkOut' | undefined,
                listingId: req.query.listingId ? parseInt(req.query.listingId as string) : undefined,
                date: req.query.date as 'today' | 'tomorrow' | undefined,
                scopes: parseList(req.query.scopes as string | string[])
            };

            const notifications = await this.turnoverService.getNotifications(filters);
            return res.status(200).json({ data: notifications });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get turnover summary counts
     */
    async getNotificationSummary(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const dateRange = req.query.dateRange;
            const fromDate = (Array.isArray(dateRange) ? dateRange[0] : req.query.fromDate) as string;
            const toDate = (Array.isArray(dateRange) ? dateRange[1] : req.query.toDate) as string;

            const parseList = (value?: string | string[]) => {
                if (!value) return undefined;
                if (Array.isArray(value)) return value;
                return value.split(',').map((v) => v.trim()).filter(Boolean);
            };

            const filters = {
                search: req.query.search as string,
                notificationType: parseList(req.query.notificationType as string | string[]),
                status: parseList(req.query.status as string | string[]),
                propertyType: parseList(req.query.propertyType as string | string[]),
                fromDate,
                toDate,
                dateField: req.query.dateField as 'checkIn' | 'checkOut' | undefined,
                listingId: req.query.listingId ? parseInt(req.query.listingId as string) : undefined,
                scopes: parseList(req.query.scopes as string | string[])
            };

            const summary = await this.turnoverService.getNotificationSummary(filters);
            return res.status(200).json({ data: summary });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get turnover settings
     */
    async getSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const parseList = (value?: string | string[]) => {
                if (!value) return undefined;
                if (Array.isArray(value)) return value;
                return value.split(',').map((v) => v.trim()).filter(Boolean);
            };
            const filters = {
                propertyType: parseList(req.query.propertyType as string | string[]),
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
     * Get global turnover settings (defaults)
     */
    async getGlobalSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const settings = await this.turnoverService.getGlobalSettings();
            return res.status(200).json({ data: settings });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update global turnover settings (defaults)
     */
    async updateGlobalSettings(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const data = req.body;
            const userId = req.user?.id;
            const settings = await this.turnoverService.updateGlobalSettings(data, userId);
            return res.status(200).json({ data: settings, message: 'Global settings updated successfully' });
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
     * Get global contacts list (active cleaners)
     */
    async getGlobalContacts(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const contacts = await this.turnoverService.getGlobalContacts();
            return res.status(200).json({ data: contacts });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get sender number options for the dropdowns, optionally filtered by label.
     */
    async getSenderNumberOptions(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const label = typeof req.query.label === "string" ? req.query.label : undefined;
            const senderNumbers = await this.turnoverService.getSenderNumberOptions(label);
            return res.status(200).json({ data: senderNumbers });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Manage list — return every sender number for the management modal.
     */
    async listSenderNumbers(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const rows = await this.turnoverService.listSenderNumbers();
            return res.status(200).json({ data: rows });
        } catch (error) {
            next(error);
        }
    }

    async createSenderNumber(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { label, countryCode, phone, displayName } = req.body || {};
            const row = await this.turnoverService.createSenderNumber(
                { label, countryCode, phone, displayName },
                req.user?.id
            );
            return res.status(201).json({ success: true, data: row });
        } catch (error: any) {
            if (error?.message && /(invalid|already exists|required)/i.test(error.message)) {
                return res.status(400).json({ success: false, message: error.message });
            }
            next(error);
        }
    }

    async updateSenderNumber(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
            const row = await this.turnoverService.updateSenderNumber(id, req.body || {}, req.user?.id);
            return res.status(200).json({ success: true, data: row });
        } catch (error: any) {
            if (error?.message && /(invalid|not found|required)/i.test(error.message)) {
                return res.status(400).json({ success: false, message: error.message });
            }
            next(error);
        }
    }

    async deleteSenderNumber(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
            await this.turnoverService.deleteSenderNumber(id);
            return res.status(200).json({ success: true });
        } catch (error: any) {
            if (error?.message && /not found/i.test(error.message)) {
                return res.status(404).json({ success: false, message: error.message });
            }
            next(error);
        }
    }

    /**
     * Sync recipient sources from Vendors and All Listings client information
     */
    async syncRecipients(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const result = await this.turnoverService.syncRecipients(req.user?.id || 'system');
            return res.status(200).json({
                success: true,
                message: 'Synced recipients from Vendors and All Listings',
                ...result
            });
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
     * Update notification status.
     * - "send" invokes the real SMS pipeline (CheckIn / Cleaner Notification services)
     *   which sends via OpenPhone and records status/sentAt/errors on the audit table.
     * - "pause" / "resume" / "skip" just flip DB flags that the 20-minute scheduler respects.
     */
    async updateNotificationStatus(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = parseInt(req.params.reservationId);
            const type = req.params.type as 'pre-stay' | 'post-stay';
            const { action } = req.body;
            const userId = req.user?.id;

            if (action === 'send') {
                try {
                    if (type === 'pre-stay') {
                        await this.checkInNotificationService.sendCheckInNotification(reservationId, true);
                    } else {
                        await this.cleanerNotificationService.sendCheckoutNotification(reservationId);
                    }
                } catch (sendError: any) {
                    logger.error(`[TurnoverController] Failed to send ${type} notification for reservation ${reservationId}:`, sendError);
                    return res.status(400).json({
                        success: false,
                        message: sendError?.message || `Failed to send ${type} notification`
                    });
                }
                return res.status(200).json({
                    success: true,
                    message: `Notification sent`
                });
            }

            const result = await this.turnoverService.updateNotificationStatus(
                reservationId,
                type,
                action,
                userId
            );

            return res.status(200).json({
                success: true,
                message: `Notification ${action} successfully`,
                data: result
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
     * Refresh cleaning notes from Hostify for one reservation
     */
    async refreshCleaningNotes(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = parseInt(req.params.reservationId);
            const result = await this.turnoverService.refreshReservationCleaningNotes(reservationId);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get the next check-in after a turnover date for a listing
     */
    async getNextCheckIn(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingId = parseInt(req.params.listingId);
            const afterDate = req.query.afterDate as string;
            const result = await this.turnoverService.getNextCheckInNotification(listingId, afterDate);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get the last checkout before a turnover date for a listing
     */
    async getLastCheckout(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const listingId = parseInt(req.params.listingId);
            const beforeDate = req.query.beforeDate as string;
            const result = await this.turnoverService.getLastCheckoutNotification(listingId, beforeDate);

            return res.status(200).json({
                success: true,
                data: result
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
