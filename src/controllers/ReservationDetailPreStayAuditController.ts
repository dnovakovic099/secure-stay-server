import { Request, Response, NextFunction } from "express";
import { ReservationDetailPreStayAuditService } from "../services/ReservationDetailPreStayAuditService";
import { CheckInNotificationService } from "../services/CheckInNotificationService";
import { CleanerCheck, CleanerNotified, CleanlinessCheck, DamageCheck, DoorCodeStatus, InventoryCheckStatus } from "../entity/ReservationDetailPreStayAudit";
import logger from "../utils/logger.utils";

interface CustomRequest extends Request {
    user?: any;
}

export class ReservationDetailPreStayAuditController {
    private preStayAuditService: ReservationDetailPreStayAuditService;
    private checkInNotificationService: CheckInNotificationService;

    constructor() {
        this.preStayAuditService = new ReservationDetailPreStayAuditService();
        this.checkInNotificationService = new CheckInNotificationService();
    }

    async createAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed, wifiConnectedAndActive, cleanlinessCheck, cleanerCheck, cleanerNotified, damageCheck, inventoryCheckStatus, approvedUpsells, notificationContactId } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                fileInfo = (req.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }
            const audit = await this.preStayAuditService.createAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed,
                attachments: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "",
                approvedUpsells,
                wifiConnectedAndActive: wifiConnectedAndActive == 'true' ? true : false,
                cleanlinessCheck: cleanlinessCheck as CleanlinessCheck,
                cleanerCheck: cleanerCheck as CleanerCheck,
                cleanerNotified: cleanerNotified as CleanerNotified,
                damageCheck: damageCheck as DamageCheck,
                inventoryCheckStatus: inventoryCheckStatus as InventoryCheckStatus,
                notificationContactId: notificationContactId ? Number(notificationContactId) : undefined
            }, userId, fileInfo);
            return res.status(201).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async updateAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed, deletedAttachments, wifiConnectedAndActive, cleanlinessCheck, cleanerCheck, cleanerNotified, damageCheck, inventoryCheckStatus, approvedUpsells, notificationContactId } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            let fileInfo: { fileName: string, filePath: string, mimeType: string; originalName: string; }[] | null = null;
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                fileInfo = (req.files['attachments'] as Express.Multer.File[]).map(file => {
                    return {
                        fileName: file.filename,
                        filePath: file.path,
                        mimeType: file.mimetype,
                        originalName: file.originalname
                    };
                }
                );
            }

            const audit = await this.preStayAuditService.updateAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed,
                deletedAttachments,
                newAttachments: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "",
                approvedUpsells,
                wifiConnectedAndActive: wifiConnectedAndActive == 'true' ? true : false,
                cleanlinessCheck: cleanlinessCheck as CleanlinessCheck,
                cleanerCheck: cleanerCheck as CleanerCheck,
                cleanerNotified: cleanerNotified as CleanerNotified,
                damageCheck: damageCheck as DamageCheck,
                inventoryCheckStatus: inventoryCheckStatus as InventoryCheckStatus,
                notificationContactId: notificationContactId ? Number(notificationContactId) : undefined
            }, userId, fileInfo);
            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async getAuditByReservationId(req: Request, res: Response, next: NextFunction) {
        try {
            const reservationId = Number(req.params.reservationId);
            const audit = await this.preStayAuditService.fetchAuditByReservationId(reservationId);
            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async migrateFileToDrive(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await this.preStayAuditService.migrateFilesToDrive();
            return res.status(200).json({ message: "Migration completed", result });
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /:reservationId/retry-checkin-sms
     * Retry sending check-in notification SMS
     */
    async retryCheckInSMS(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = Number(req.params.reservationId);
            const { contactId } = req.body;

            logger.info(`[PreStayAudit] Manually sending check-in SMS for reservation ${reservationId}`);

            // forceManual=true bypasses the feature toggle for manual sends
            await this.checkInNotificationService.sendCheckInNotification(reservationId, true);

            return res.status(200).json({
                success: true,
                message: "Check-in notification SMS sent successfully"
            });
        } catch (error: any) {
            logger.error(`[PreStayAudit] Error sending check-in SMS:`, error.message);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to send check-in notification SMS"
            });
        }
    }
}