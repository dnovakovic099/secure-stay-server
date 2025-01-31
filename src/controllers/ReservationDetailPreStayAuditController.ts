import { Request, Response, NextFunction } from "express";
import { ReservationDetailPreStayAuditService } from "../services/ReservationDetailPreStayAuditService";
import { DoorCodeStatus } from "../entity/ReservationDetailPreStayAudit";

export class ReservationDetailPreStayAuditController {
    private preStayAuditService: ReservationDetailPreStayAuditService;

    constructor() {
        this.preStayAuditService = new ReservationDetailPreStayAuditService();
    }

    async createAudit(req: Request, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed } = req.body;
            const { reservationId } = req.params;

            const audit = await this.preStayAuditService.createAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed
            });
            return res.status(201).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async updateAudit(req: Request, res: Response, next: NextFunction) {
        try {
            const { doorCode, amenitiesConfirmed } = req.body;
            const { reservationId } = req.params;

            const audit = await this.preStayAuditService.updateAudit({
                reservationId,
                doorCode: doorCode as DoorCodeStatus,
                amenitiesConfirmed
            });
            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async getAuditByReservationId(req: Request, res: Response, next: NextFunction) {
        try {
            const { reservationId } = req.params;
            const audit = await this.preStayAuditService.fetchAuditByReservationId(reservationId);
            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }
} 