import { Request, Response, NextFunction } from "express";
import { ReservationDetailPostStayAuditService } from "../services/ReservationDetailPostStayAuditService";
import { DamageReport, MissingItems, PotentialReviewIssue, UtilityIssues, KeysAndLocks, GuestBookCheck, SecurityDepositStatus } from "../entity/ReservationDetailPostStayAudit";

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
                keysAndLocks,
                guestBookCheck,
                securityDepositStatus,
                approvedUpsells,
                cleanerNotificationContactId
            } = req.body;
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

            const audit = await this.postStayAuditService.createAudit({
                reservationId,
                maintenanceIssues,
                cleaningIssues,
                cleaningSupplies,
                refundForReview,
                airbnbReimbursement,
                luxuryLodgingReimbursement,
                potentialReviewIssue: potentialReviewIssue as PotentialReviewIssue,
                attachments: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "",
                damageReport: damageReport as DamageReport,
                damageReportNotes,
                missingItems: missingItems as MissingItems,
                missingItemsNotes,
                utilityIssues: utilityIssues as UtilityIssues,
                keysAndLocks: keysAndLocks as KeysAndLocks,
                guestBookCheck: guestBookCheck as GuestBookCheck,
                securityDepositStatus: securityDepositStatus as SecurityDepositStatus,
                approvedUpsells: approvedUpsells,
                cleanerNotificationContactId: cleanerNotificationContactId ? Number(cleanerNotificationContactId) : null
            }, userId, fileInfo);

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
                keysAndLocks,
                guestBookCheck,
                securityDepositStatus,
                deletedAttachments,
                approvedUpsells,
                reasonForMissingIssue,
                improvementSuggestion,
                cleanerNotificationContactId
            } = req.body;
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
                keysAndLocks: keysAndLocks as KeysAndLocks,
                guestBookCheck: guestBookCheck as GuestBookCheck,
                securityDepositStatus: securityDepositStatus as SecurityDepositStatus,
                deletedAttachments: deletedAttachments,
                newAttachments: fileInfo ? JSON.stringify(fileInfo.map(file => file.fileName)) : "",
                approvedUpsells: approvedUpsells,
                reasonForMissingIssue,
                improvementSuggestion,
                cleanerNotificationContactId: cleanerNotificationContactId ? Number(cleanerNotificationContactId) : null
            }, userId, fileInfo);

            return res.status(200).json(audit);
        } catch (error) {
            console.log(error.stack);
            
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

    async migrateFileToDrive(req: Request, res: Response, next: NextFunction) {
        try {
            const { fromDate, toDate } = req.body;
            if (!fromDate || !toDate) {
                return res.status(400).json({ message: "fromDate and toDate are required" });
            }
            const result = await this.postStayAuditService.migrateFilesToDrive(fromDate, toDate);
            return res.status(200).json({message: "Migration completed", details: result});
        } catch (error) {
            next(error);
        }
    }

    async retryCleanerSMS(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const reservationId = Number(req.params.reservationId);

            // Import the service here to avoid circular dependencies
            const { CleanerNotificationService } = await import('../services/CleanerNotificationService');
            const cleanerNotificationService = new CleanerNotificationService();

            await cleanerNotificationService.sendCheckoutNotification(reservationId);

            return res.status(200).json({
                message: "Cleaner notification SMS retry initiated successfully"
            });
        } catch (error) {
            next(error);
        }
    }
} 