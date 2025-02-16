import { Repository } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationDetailPreStayAudit, CompletionStatus, DoorCodeStatus, CleanerCheck, CleanerNotified, CleanlinessCheck, DamageCheck, InventoryCheckStatus     } from "../entity/ReservationDetailPreStayAudit";

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

    constructor() {
        this.preStayAuditRepository = appDatabase.getRepository(ReservationDetailPreStayAudit);
    }

    async fetchAuditByReservationId(reservationId: number): Promise<ReservationDetailPreStayAudit | null> {
        return await this.preStayAuditRepository.findOne({ where: { reservationId: Number(reservationId) } });
    }

    async fetchCompletionStatusByReservationId(reservationId: number): Promise<CompletionStatus | null> {
        const audit = await this.fetchAuditByReservationId(reservationId);
        return audit ? audit.completionStatus : CompletionStatus.NOT_STARTED;
    }

    async createAudit(dto: ReservationDetailPreStayAuditDTO, userId: string): Promise<ReservationDetailPreStayAudit> {
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

        return await this.preStayAuditRepository.save(audit);
    }

    async updateAudit(dto: ReservationDetailPreStayAuditUpdateDTO, userId: string): Promise<ReservationDetailPreStayAudit> {
        const audit = await this.fetchAuditByReservationId(dto.reservationId);

        if (!audit) {
            throw new Error("Audit not found");
        }
      
        const deletedAttachments = dto.deletedAttachments ? JSON.parse(dto.deletedAttachments) : [];
        const updatedAttachments = JSON.parse(audit.attachments).filter(attachment => !deletedAttachments.includes(attachment));
        const finalAttachments = [...updatedAttachments, ...JSON.parse(dto.newAttachments)];

        audit.doorCode = dto.doorCode ?? audit.doorCode;
        audit.amenitiesConfirmed = dto.amenitiesConfirmed ?? audit.amenitiesConfirmed;
        audit.completionStatus = this.determineCompletionStatus(dto);
        audit.damageCheck = dto.damageCheck ?? audit.damageCheck;
        audit.inventoryCheckStatus = dto.inventoryCheckStatus ?? audit.inventoryCheckStatus;
        audit.attachments = JSON.stringify(finalAttachments) ?? '';
        audit.approvedUpsells = dto.approvedUpsells ?? audit.approvedUpsells;
        audit.wifiConnectedAndActive = dto.wifiConnectedAndActive ?? audit.wifiConnectedAndActive;
        audit.cleanlinessCheck = dto.cleanlinessCheck ?? audit.cleanlinessCheck;
        audit.cleanerCheck = dto.cleanerCheck ?? audit.cleanerCheck;
        audit.cleanerNotified = dto.cleanerNotified ?? audit.cleanerNotified;
        audit.updatedBy = userId;
        audit.updatedAt = new Date();

        return await this.preStayAuditRepository.save(audit);
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
} 