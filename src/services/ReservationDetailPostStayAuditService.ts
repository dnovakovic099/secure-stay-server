import { Between, Repository } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationDetailPostStayAudit, CompletionStatus, PotentialReviewIssue, DamageReport, MissingItems, UtilityIssues, KeysAndLocks, GuestBookCheck, SecurityDepositStatus } from "../entity/ReservationDetailPostStayAudit";
import { FileInfo } from "../entity/FileInfo";
import logger from "../utils/logger.utils";

interface ReservationDetailPostStayAuditDTO {
    reservationId: number;
    maintenanceIssues?: string;
    cleaningIssues?: string;
    cleaningSupplies?: number;
    refundForReview?: number;
    airbnbReimbursement?: number;
    luxuryLodgingReimbursement?: number;
    potentialReviewIssue?: PotentialReviewIssue;
    attachments?: string;
    damageReport?: DamageReport;
    damageReportNotes?: string;
    missingItems?: MissingItems;
    missingItemsNotes?: string;
    utilityIssues?: UtilityIssues;
    keysAndLocks?: KeysAndLocks;
    guestBookCheck?: GuestBookCheck;
    securityDepositStatus?: SecurityDepositStatus;
    approvedUpsells?: string;
    reasonForMissingIssue?: string;
    improvementSuggestion?: string;
}

interface ReservationDetailPostStayAuditUpdateDTO extends ReservationDetailPostStayAuditDTO {
    deletedAttachments?: string;
    newAttachments?: string;
}


export class ReservationDetailPostStayAuditService {
    private postStayAuditRepository: Repository<ReservationDetailPostStayAudit>;
    private fileInfoRepo: Repository<FileInfo> = appDatabase.getRepository(FileInfo);

    constructor() {
        this.postStayAuditRepository = appDatabase.getRepository(ReservationDetailPostStayAudit);
    }

    async fetchAuditByReservationId(reservationId: number): Promise<(ReservationDetailPostStayAudit & { fileInfo: FileInfo[]; }) | null> {

        const data = await this.postStayAuditRepository.findOne({ where: { reservationId } });
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'post-stay-audit', entityId: reservationId } });
        return data ? { ...data, fileInfo } : null;
    }

    async fetchCompletionStatusByReservationId(reservationId: number): Promise<CompletionStatus | null> {
        const audit = await this.fetchAuditByReservationId(reservationId);
        return audit ? audit.completionStatus : CompletionStatus.NOT_STARTED;
    }

    async createAudit(dto: ReservationDetailPostStayAuditDTO, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]): Promise<ReservationDetailPostStayAudit> {
        const audit = this.postStayAuditRepository.create({
            reservationId: dto.reservationId,
            maintenanceIssues: dto.maintenanceIssues,
            cleaningIssues: dto.cleaningIssues,
            cleaningSupplies: dto.cleaningSupplies,
            refundForReview: dto.refundForReview,
            airbnbReimbursement: dto.airbnbReimbursement,
            luxuryLodgingReimbursement: dto.luxuryLodgingReimbursement,
            potentialReviewIssue: dto.potentialReviewIssue,
            completionStatus: this.determineCompletionStatus(dto),
            createdBy: userId,
            attachments: dto.attachments,
            damageReport: dto.damageReport,
            damageReportNotes: dto.damageReportNotes,
            missingItems: dto.missingItems,
            missingItemsNotes: dto.missingItemsNotes,
            utilityIssues: dto.utilityIssues,
            keysAndLocks: dto.keysAndLocks,
            guestBookCheck: dto.guestBookCheck,
            securityDepositStatus: dto.securityDepositStatus,
            approvedUpsells: dto.approvedUpsells,
        });

        const savedData = await this.postStayAuditRepository.save(audit);

        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'post-stay-audit';
                fileRecord.entityId = savedData.reservationId;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }

        return savedData;
    }

    async updateAudit(dto: ReservationDetailPostStayAuditUpdateDTO, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]): Promise<ReservationDetailPostStayAudit> {
        const audit = await this.fetchAuditByReservationId(dto.reservationId);

        if (!audit) {
            throw new Error("Audit not found");
        }

        const deletedAttachments = dto.deletedAttachments ? JSON.parse(dto.deletedAttachments) : [];
        const updatedAttachments = audit.attachments ? JSON.parse(audit.attachments).filter(attachment => !deletedAttachments.includes(attachment)) : [];
        const finalAttachments = dto.newAttachments ? [...updatedAttachments, ...JSON.parse(dto.newAttachments)] : null;

        audit.maintenanceIssues = dto.maintenanceIssues ?? audit.maintenanceIssues;
        audit.cleaningIssues = dto.cleaningIssues ?? audit.cleaningIssues;
        audit.cleaningSupplies = dto.cleaningSupplies ?? audit.cleaningSupplies;
        audit.refundForReview = dto.refundForReview ?? audit.refundForReview;
        audit.attachments = finalAttachments ? JSON.stringify(finalAttachments) : audit.attachments;
        audit.airbnbReimbursement = dto.airbnbReimbursement ?? audit.airbnbReimbursement;
        audit.luxuryLodgingReimbursement = dto.luxuryLodgingReimbursement ?? audit.luxuryLodgingReimbursement;
        audit.potentialReviewIssue = dto.potentialReviewIssue ?? audit.potentialReviewIssue;
        audit.damageReport = dto.damageReport ?? audit.damageReport;
        audit.damageReportNotes = dto.damageReportNotes ?? audit.damageReportNotes;
        audit.missingItems = dto.missingItems ?? audit.missingItems;
        audit.missingItemsNotes = dto.missingItemsNotes ?? audit.missingItemsNotes;
        audit.utilityIssues = dto.utilityIssues ?? audit.utilityIssues;
        audit.keysAndLocks = dto.keysAndLocks ?? audit.keysAndLocks;
        audit.guestBookCheck = dto.guestBookCheck ?? audit.guestBookCheck;
        audit.securityDepositStatus = dto.securityDepositStatus ?? audit.securityDepositStatus;
        audit.completionStatus = this.determineCompletionStatus(audit);
        audit.updatedBy = userId;
        audit.updatedAt = new Date();
        audit.approvedUpsells = dto.approvedUpsells ?? audit.approvedUpsells;
        audit.reasonForMissingIssue = dto.reasonForMissingIssue ?? audit.reasonForMissingIssue;
        audit.improvementSuggestion = dto.improvementSuggestion ?? audit.improvementSuggestion;

        const updatedData = await this.postStayAuditRepository.save(audit);
        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'post-stay-audit';
                fileRecord.entityId = updatedData.reservationId;
                fileRecord.fileName = file.fileName;
                fileRecord.createdBy = userId;
                fileRecord.localPath = file.filePath;
                fileRecord.mimetype = file.mimeType;
                fileRecord.originalName = file.originalName;
                await this.fileInfoRepo.save(fileRecord);
            }
        }
        return updatedData;
    }

    private determineCompletionStatus(audit: Partial<ReservationDetailPostStayAuditDTO | ReservationDetailPostStayAuditUpdateDTO>): CompletionStatus {
        const isDamageReportFilled = () => {
            if (audit.damageReport === 'yes') {
                return audit.damageReportNotes && audit.damageReportNotes.trim().length > 0;
            }
            return audit.damageReport === 'no';
        };

        const isMissingItemsFilled = () => {
            if (audit.missingItems === 'yes') {
                return audit.missingItemsNotes && audit.missingItemsNotes.trim().length >  0;
            }
            return audit.missingItems === 'no';
        };

        const isValidMoneyValue = (value: string) => {
            const numValue = parseFloat(value);;
            return !isNaN(numValue) && numValue > 0;
        };

        const hasValues = [
            audit.maintenanceIssues && audit.maintenanceIssues.trim().length > 0,
            // audit.cleaningIssues && audit.cleaningIssues.trim().length > 0,
            // isValidMoneyValue(audit.cleaningSupplies.toString()),
            // isValidMoneyValue(audit.refundForReview.toString()),
            // isValidMoneyValue(audit.airbnbReimbursement.toString()),
            // isValidMoneyValue(audit.luxuryLodgingReimbursement.toString()),
            // audit.potentialReviewIssue && audit.potentialReviewIssue !== 'unset',
            isDamageReportFilled(),
            isMissingItemsFilled(),
            audit.utilityIssues && audit.utilityIssues !== 'unset',
            audit.keysAndLocks && audit.keysAndLocks !== 'unset',
            // audit.guestBookCheck && audit.guestBookCheck !== 'unset',
            // audit.securityDepositStatus && audit.securityDepositStatus !== 'unset'
        ].every(Boolean);

        const hasAnyValue = [
            audit.maintenanceIssues && audit.maintenanceIssues.trim().length > 0,
            audit.cleaningIssues && audit.cleaningIssues.trim().length > 0,
            isValidMoneyValue(audit.cleaningSupplies.toString()),
            isValidMoneyValue(audit.refundForReview.toString()),
            isValidMoneyValue(audit.airbnbReimbursement.toString()),
            isValidMoneyValue(audit.luxuryLodgingReimbursement.toString()),
            audit.potentialReviewIssue && audit.potentialReviewIssue !== 'unset',
            isDamageReportFilled(),
            isMissingItemsFilled(),
            audit.utilityIssues && audit.utilityIssues !== 'unset',
            audit.keysAndLocks && audit.keysAndLocks !== 'unset',
            audit.guestBookCheck && audit.guestBookCheck !== 'unset',
            audit.securityDepositStatus && audit.securityDepositStatus !== 'unset'
        ].some(Boolean);



        if (hasValues) return CompletionStatus.COMPLETED;
        if (hasAnyValue) return CompletionStatus.IN_PROGRESS;
        return CompletionStatus.NOT_STARTED;
    }


    async migrateFilesToDrive(fromDate: string, toDate: string) {
        const audits = await this.postStayAuditRepository.find({
            where: {
                createdAt: Between(new Date(fromDate), new Date(toDate))
            }
        });
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'post-stay-audit' } });
        for (const audit of audits) {
            try {
                if (audit.attachments) {
                    const attachments = JSON.parse(audit.attachments);
                    const filesForAudit = fileInfo.filter(file => file.entityId == audit.reservationId);
                    logger.info(JSON.stringify(filesForAudit));
                    for (const attachment of attachments) {
                        const fileExists = filesForAudit.find(f => f.fileName === attachment);
                        logger.info(JSON.stringify(fileExists));
                        if (!fileExists) {
                            logger.info(`Migrating file for reservationId ${audit.reservationId}: ${attachment}`);
                            const fileRecord = new FileInfo();
                            fileRecord.entityType = 'post-stay-audit';
                            fileRecord.entityId = audit.reservationId;
                            fileRecord.fileName = attachment;
                            fileRecord.createdBy = audit.createdBy;
                            fileRecord.localPath = `${process.cwd()}/dist/public/post-stay-audit/${attachment}`;
                            fileRecord.mimetype = null;
                            fileRecord.originalName = null;
                            await this.fileInfoRepo.save(fileRecord);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error migrating files for reservationId ${audit.reservationId}: ${error.message}`);
            }
        }
    }
} 