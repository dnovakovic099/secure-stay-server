import { Request, Response, NextFunction } from "express";
import { ReservationDetailPostStayAuditService } from "../services/ReservationDetailPostStayAuditService";
import { PotentialReviewIssue } from "../entity/ReservationDetailPostStayAudit";

interface CustomRequest extends Request {
    user?: any;
}

export class ReservationDetailPostStayAuditController {
    private postStayAuditService: ReservationDetailPostStayAuditService;

    constructor() {
        this.postStayAuditService = new ReservationDetailPostStayAuditService();
    }

    async createAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const {
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue
            } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            const audit = await this.postStayAuditService.createAudit({
                reservationId,
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue: potentialReviewIssue as PotentialReviewIssue
            }, userId);

            return res.status(201).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async updateAudit(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const {
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue
            } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            const audit = await this.postStayAuditService.updateAudit({
                reservationId,
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue: potentialReviewIssue as PotentialReviewIssue
            }, userId);

            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }

    async getAuditByReservationId(req: Request, res: Response, next: NextFunction) {
        try {
            const reservationId = Number(req.params.reservationId);
            const audit = await this.postStayAuditService.fetchAuditByReservationId(reservationId);
            return res.status(200).json(audit);
        } catch (error) {
            next(error);
        }
    }
} 