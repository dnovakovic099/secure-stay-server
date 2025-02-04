import { Repository } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationDetailPreStayAudit, CompletionStatus, DoorCodeStatus } from "../entity/ReservationDetailPreStayAudit";

interface ReservationDetailPreStayAuditDTO {
    reservationId: number;
    doorCode?: DoorCodeStatus;
    amenitiesConfirmed?: string;
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

    async createAudit(dto: ReservationDetailPreStayAuditDTO): Promise<ReservationDetailPreStayAudit> {
        const audit = this.preStayAuditRepository.create({
            reservationId: dto.reservationId,
            doorCode: dto.doorCode,
            amenitiesConfirmed: dto.amenitiesConfirmed,
            completionStatus: this.determineCompletionStatus(dto.doorCode, dto.amenitiesConfirmed)
        });

        return await this.preStayAuditRepository.save(audit);
    }

    async updateAudit(dto: ReservationDetailPreStayAuditDTO): Promise<ReservationDetailPreStayAudit> {
        const audit = await this.fetchAuditByReservationId(dto.reservationId);

        if (!audit) {
            throw new Error("Audit not found");
        }

        audit.doorCode = dto.doorCode ?? audit.doorCode;
        audit.amenitiesConfirmed = dto.amenitiesConfirmed ?? audit.amenitiesConfirmed;
        audit.completionStatus = this.determineCompletionStatus(audit.doorCode, audit.amenitiesConfirmed);

        return await this.preStayAuditRepository.save(audit);
    }

    private determineCompletionStatus(doorCode?: DoorCodeStatus, amenitiesConfirmed?: string): CompletionStatus {
        if (doorCode === DoorCodeStatus.UNSET && (!amenitiesConfirmed || amenitiesConfirmed.trim() === '')) {
            return CompletionStatus.NOT_STARTED;
        }
        return (doorCode !== DoorCodeStatus.UNSET && amenitiesConfirmed) ? CompletionStatus.COMPLETED : CompletionStatus.IN_PROGRESS;
    }
} 