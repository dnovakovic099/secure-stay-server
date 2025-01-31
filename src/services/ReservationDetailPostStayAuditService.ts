import { Repository } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationDetailPostStayAudit, CompletionStatus, PotentialReviewIssue } from "../entity/ReservationDetailPostStayAudit";

interface ReservationDetailPostStayAuditDTO {
    reservationId: string;
    maintenanceIssues?: string;
    cleaningIssues?: string;
    cleaningSupplies?: number;
    refundForReview?: number;
    airbnbReimbursement?: number;
    luxuryLodgingReimbursement?: number;
    potentialReviewIssue?: PotentialReviewIssue;
}

export class ReservationDetailPostStayAuditService {
    private postStayAuditRepository: Repository<ReservationDetailPostStayAudit>;

    constructor() {
        this.postStayAuditRepository = appDatabase.getRepository(ReservationDetailPostStayAudit);
    }

    async fetchAuditByReservationId(reservationId: string): Promise<ReservationDetailPostStayAudit | null> {
        return await this.postStayAuditRepository.findOne({ where: { reservationId } });
    }

    async fetchCompletionStatusByReservationId(reservationId: string): Promise<CompletionStatus | null> {
        const audit = await this.fetchAuditByReservationId(reservationId);
        return audit ? audit.completionStatus : CompletionStatus.NOT_STARTED;
    }

    async createAudit(dto: ReservationDetailPostStayAuditDTO): Promise<ReservationDetailPostStayAudit> {
        const audit = this.postStayAuditRepository.create({
            reservationId: dto.reservationId,
            maintenanceIssues: dto.maintenanceIssues,
            cleaningIssues: dto.cleaningIssues,
            cleaningSupplies: dto.cleaningSupplies,
            refundForReview: dto.refundForReview,
            airbnbReimbursement: dto.airbnbReimbursement,
            luxuryLodgingReimbursement: dto.luxuryLodgingReimbursement,
            potentialReviewIssue: dto.potentialReviewIssue,
            completionStatus: this.determineCompletionStatus(dto)
        });

        return await this.postStayAuditRepository.save(audit);
    }

    async updateAudit(dto: ReservationDetailPostStayAuditDTO): Promise<ReservationDetailPostStayAudit> {
        const audit = await this.fetchAuditByReservationId(dto.reservationId);

        if (!audit) {
            throw new Error("Audit not found");
        }

        audit.maintenanceIssues = dto.maintenanceIssues ?? audit.maintenanceIssues;
        audit.cleaningIssues = dto.cleaningIssues ?? audit.cleaningIssues;
        audit.cleaningSupplies = dto.cleaningSupplies ?? audit.cleaningSupplies;
        audit.refundForReview = dto.refundForReview ?? audit.refundForReview;
        audit.airbnbReimbursement = dto.airbnbReimbursement ?? audit.airbnbReimbursement;
        audit.luxuryLodgingReimbursement = dto.luxuryLodgingReimbursement ?? audit.luxuryLodgingReimbursement;
        audit.potentialReviewIssue = dto.potentialReviewIssue ?? audit.potentialReviewIssue;
        audit.completionStatus = this.determineCompletionStatus(audit);

        return await this.postStayAuditRepository.save(audit);
    }

    private determineCompletionStatus(audit: Partial<ReservationDetailPostStayAuditDTO>): CompletionStatus {
        const hasValues = [
            audit.maintenanceIssues,
            audit.cleaningIssues,
            audit.cleaningSupplies,
            audit.refundForReview,
            audit.airbnbReimbursement,
            audit.luxuryLodgingReimbursement,
            audit.potentialReviewIssue
        ].every(value => {
            if (value === null || value === undefined) return false;
            if (typeof value === 'number') return value > 0;
            if (value === 'unset') return false;
            return true;
        });

        return hasValues ? CompletionStatus.COMPLETED : CompletionStatus.IN_PROGRESS;
    }
} 