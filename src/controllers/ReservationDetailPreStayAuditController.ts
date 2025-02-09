import { Request, Response, NextFunction } from "express";
import { ReservationDetailPreStayAuditService } from "../services/ReservationDetailPreStayAuditService";
import { CleanerCheck, CleanerNotified, CleanlinessCheck, DamageCheck, DoorCodeStatus, InventoryCheckStatus } from "../entity/ReservationDetailPreStayAudit";

interface CustomRequest extends Request {
    user?: any;
}

export class ReservationDetailPreStayAuditController {
    private preStayAuditService: ReservationDetailPreStayAuditService;

    constructor() {
        this.preStayAuditService = new ReservationDetailPreStayAuditService();
    }

    async createAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed , wifiConnectedAndActive, cleanlinessCheck, cleanerCheck, cleanerNotified,damageCheck,inventoryCheckStatus} = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            let attachmentNames: string[] = [];
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                attachmentNames = (req.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const audit = await this.preStayAuditService.createAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed,
                attachments: JSON.stringify(attachmentNames) || '',
                wifiConnectedAndActive: wifiConnectedAndActive == 'true' ? true : false,
                cleanlinessCheck: cleanlinessCheck as CleanlinessCheck,
                cleanerCheck: cleanerCheck as CleanerCheck,
                cleanerNotified: cleanerNotified as CleanerNotified,
                damageCheck: damageCheck as DamageCheck,
                inventoryCheckStatus: inventoryCheckStatus as InventoryCheckStatus
            }, userId);
            return res.status(201).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async updateAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed,deletedAttachments, wifiConnectedAndActive, cleanlinessCheck, cleanerCheck, cleanerNotified, damageCheck, inventoryCheckStatus } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;


            let newAttachments: string[] = [];
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                newAttachments = (req.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const audit = await this.preStayAuditService.updateAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed,
                deletedAttachments: deletedAttachments,
                newAttachments: JSON.stringify(newAttachments),
                wifiConnectedAndActive: wifiConnectedAndActive == 'true' ? true : false,
                cleanlinessCheck: cleanlinessCheck as CleanlinessCheck,
                cleanerCheck: cleanerCheck as CleanerCheck,
                cleanerNotified: cleanerNotified as CleanerNotified,
                damageCheck: damageCheck as DamageCheck,
                inventoryCheckStatus: inventoryCheckStatus as InventoryCheckStatus
            }, userId);
            return res.status(200).json(audit);
        } catch (error) {
            console.log(error);
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
} 