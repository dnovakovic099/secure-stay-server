import { Repository } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationDetailPreStayAudit, CompletionStatus, DoorCodeStatus, CleanerCheck, CleanerNotified, CleanlinessCheck, DamageCheck, InventoryCheckStatus     } from "../entity/ReservationDetailPreStayAudit";
import { FileInfo } from "../entity/FileInfo";
import logger from "../utils/logger.utils";

interface ReservationDetailPreStayAuditDTO {
    reservationId: number;
    doorCode?: DoorCodeStatus;
    amenitiesConfirmed?: string;
    attachments?: string;
    approvedUpsells?: string;
    wifiConnectedAndActive?: boolean;
    cleanlinessCheck?: CleanlinessCheck;
    cleanerCheck?: CleanerCheck;
    cleanerNotified?: CleanerNotified;
    damageCheck?: DamageCheck;
    inventoryCheckStatus?: InventoryCheckStatus;
}

// prepare dto for update, and include newAttachments

interface ReservationDetailPreStayAuditUpdateDTO extends ReservationDetailPreStayAuditDTO {
    newAttachments?: string;
    deletedAttachments?: string;
}

export class ReservationDetailPreStayAuditService {
    private preStayAuditRepository: Repository<ReservationDetailPreStayAudit>;
    private fileInfoRepo: Repository<FileInfo> = appDatabase.getRepository(FileInfo);

    constructor() {
        this.preStayAuditRepository = appDatabase.getRepository(ReservationDetailPreStayAudit);
    }

    async fetchAuditByReservationId(reservationId: number): Promise<ReservationDetailPreStayAudit & { fileInfo: FileInfo[]; }> {
        const data= await this.preStayAuditRepository.findOne({ where: { reservationId: Number(reservationId) } });
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'pre-stay-audit', entityId: reservationId } });
        return data ? { ...data, fileInfo } : null;
    }

    async fetchCompletionStatusByReservationId(reservationId: number): Promise<CompletionStatus | null> {
        const audit = await this.fetchAuditByReservationId(reservationId);
        return audit ? audit.completionStatus : CompletionStatus.NOT_STARTED;
    }

    /**
     * Batch fetch completion statuses for multiple reservations
     * Used for performance optimization to avoid N+1 queries
     */
    async fetchCompletionStatusesByReservationIds(reservationIds: number[]): Promise<Map<number, CompletionStatus>> {
        if (reservationIds.length === 0) {
            return new Map();
        }

        const { In } = await import("typeorm");
        const audits = await this.preStayAuditRepository.find({
            where: { reservationId: In(reservationIds) },
            select: ['reservationId', 'completionStatus']
        });

        const result = new Map<number, CompletionStatus>();
        // Set default for all requested IDs
        for (const id of reservationIds) {
            result.set(id, CompletionStatus.NOT_STARTED);
        }
        // Override with actual values
        for (const audit of audits) {
            result.set(audit.reservationId, audit.completionStatus);
        }
        return result;
    }

    async createAudit(dto: ReservationDetailPreStayAuditDTO, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]): Promise<ReservationDetailPreStayAudit> {
        const audit = this.preStayAuditRepository.create({
            reservationId: dto.reservationId,
            doorCode: dto.doorCode,
            amenitiesConfirmed: dto.amenitiesConfirmed,
            attachments: dto.attachments,
            approvedUpsells: dto.approvedUpsells,
            wifiConnectedAndActive: dto.wifiConnectedAndActive,
            cleanlinessCheck: dto.cleanlinessCheck,
            cleanerCheck: dto.cleanerCheck,
            cleanerNotified: dto.cleanerNotified,
            completionStatus: this.determineCompletionStatus(dto),
            damageCheck: dto.damageCheck,
            inventoryCheckStatus: dto.inventoryCheckStatus,
            createdBy: userId
        });

        const savedData = await this.preStayAuditRepository.save(audit);

        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'pre-stay-audit';
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

    async updateAudit(dto: ReservationDetailPreStayAuditUpdateDTO, userId: string, fileInfo?: { fileName: string, filePath: string, mimeType: string; originalName: string; }[]): Promise<ReservationDetailPreStayAudit> {
        const audit = await this.fetchAuditByReservationId(dto.reservationId);

        if (!audit) {
            throw new Error("Audit not found");
        }
      
        const deletedAttachments = dto.deletedAttachments ? JSON.parse(dto.deletedAttachments) : [];
        const updatedAttachments = audit.attachments ? JSON.parse(audit.attachments).filter(attachment => !deletedAttachments.includes(attachment)) : [];
        const finalAttachments = dto.newAttachments ? [...updatedAttachments, ...JSON.parse(dto.newAttachments)] : null;

        audit.doorCode = dto.doorCode ?? audit.doorCode;
        audit.amenitiesConfirmed = dto.amenitiesConfirmed ?? audit.amenitiesConfirmed;
        audit.completionStatus = this.determineCompletionStatus(dto);
        audit.damageCheck = dto.damageCheck ?? audit.damageCheck;
        audit.inventoryCheckStatus = dto.inventoryCheckStatus ?? audit.inventoryCheckStatus;
        audit.attachments = finalAttachments ? JSON.stringify(finalAttachments) : audit.attachments;
        audit.approvedUpsells = dto.approvedUpsells ?? audit.approvedUpsells;
        audit.wifiConnectedAndActive = dto.wifiConnectedAndActive ?? audit.wifiConnectedAndActive;
        audit.cleanlinessCheck = dto.cleanlinessCheck ?? audit.cleanlinessCheck;
        audit.cleanerCheck = dto.cleanerCheck ?? audit.cleanerCheck;
        audit.cleanerNotified = dto.cleanerNotified ?? audit.cleanerNotified;
        audit.updatedBy = userId;
        audit.updatedAt = new Date();

        const updatedData = await this.preStayAuditRepository.save(audit);

        if (fileInfo) {
            for (const file of fileInfo) {
                const fileRecord = new FileInfo();
                fileRecord.entityType = 'pre-stay-audit';
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

    private determineCompletionStatus(dto: ReservationDetailPreStayAuditDTO | ReservationDetailPreStayAuditUpdateDTO): CompletionStatus {
        // if all fields are filled, return COMPLETED
        // if any field is empty, return IN_PROGRESS
        // if any field is not filled, return NOT_STARTED
        if (dto.doorCode == DoorCodeStatus.UNSET && dto.amenitiesConfirmed == '' && dto.wifiConnectedAndActive == false && dto.cleanlinessCheck == CleanlinessCheck.UNSET && dto.cleanerCheck == CleanerCheck.UNSET && dto.cleanerNotified == CleanerNotified.UNSET && dto.damageCheck == DamageCheck.UNSET && dto.inventoryCheckStatus == InventoryCheckStatus.UNSET) {
            return CompletionStatus.NOT_STARTED;
        }
        if (dto.doorCode != DoorCodeStatus.UNSET && dto.amenitiesConfirmed != '' && dto.wifiConnectedAndActive != false && dto.cleanlinessCheck != CleanlinessCheck.UNSET && dto.cleanerCheck != CleanerCheck.UNSET && dto.cleanerNotified != CleanerNotified.UNSET && dto.damageCheck != DamageCheck.UNSET && dto.inventoryCheckStatus != InventoryCheckStatus.UNSET) {
            return CompletionStatus.COMPLETED;
        }
        return CompletionStatus.IN_PROGRESS;

        
    }

    async migrateFilesToDrive() {
        const audits = await this.preStayAuditRepository.find();
        const fileInfo = await this.fileInfoRepo.find({ where: { entityType: 'pre-stay-audit' } });
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
                            fileRecord.entityType = 'pre-stay-audit';
                            fileRecord.entityId = audit.reservationId;
                            fileRecord.fileName = attachment;
                            fileRecord.createdBy = audit.createdBy;
                            fileRecord.localPath = `${process.cwd()}/dist/public/pre-stay-audit/${attachment}`;
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