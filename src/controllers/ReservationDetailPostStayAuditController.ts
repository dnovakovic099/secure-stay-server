import { Request, Response, NextFunction } from "express";
import { ReservationDetailPostStayAuditService } from "../services/ReservationDetailPostStayAuditService";
import { DamageReport, MissingItems, PotentialReviewIssue, UtilityIssues } from "../entity/ReservationDetailPostStayAudit";

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
                potentialReviewIssue,
                damageReport,
                damageReportNotes,
                missingItems,
                missingItemsNotes,
                utilityIssues,
            } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            let attachmentNames: string[] = [];
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                attachmentNames = (req.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const audit = await this.postStayAuditService.createAudit({
                reservationId,
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue: potentialReviewIssue as PotentialReviewIssue,
                attachments: JSON.stringify(attachmentNames) || '',
                damageReport: damageReport as DamageReport,
                damageReportNotes,
                missingItems: missingItems as MissingItems,
                missingItemsNotes,
                utilityIssues: utilityIssues as UtilityIssues
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
                potentialReviewIssue,
                damageReport,
                damageReportNotes,
                missingItems,
                missingItemsNotes,
                utilityIssues,
                deletedAttachments,
            } = req.body;
            const reservationId = Number(req.params.reservationId);
            const userId = req.user.id;

            let newAttachments: string[] = [];
            if (Array.isArray(req.files['attachments']) && req.files['attachments'].length > 0) {
                newAttachments = (req.files['attachments'] as Express.Multer.File[]).map(file => file.filename);
            }

            const audit = await this.postStayAuditService.updateAudit({
                reservationId,
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue: potentialReviewIssue as PotentialReviewIssue,
                damageReport: damageReport as DamageReport,
                damageReportNotes,
                missingItems: missingItems as MissingItems,
                missingItemsNotes,
                utilityIssues: utilityIssues as UtilityIssues,
                deletedAttachments: deletedAttachments,
                newAttachments: JSON.stringify(newAttachments)
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