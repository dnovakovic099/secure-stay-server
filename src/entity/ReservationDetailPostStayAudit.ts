import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum CompletionStatus {
    NOT_STARTED = 'Not Started',
    IN_PROGRESS = 'In Progress',
    COMPLETED = 'Completed'
}

export enum PotentialReviewIssue {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

@Entity('reservation_detail_post_stay_audit')
export class ReservationDetailPostStayAudit {
    @PrimaryColumn({ type: 'varchar' })
    reservationId: string;

    @Column({ 
        type: 'text',
        nullable: true 
    })
    maintenanceIssues: string;

    @Column({ 
        type: 'text',
        nullable: true 
    })
    cleaningIssues: string;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    cleaningSupplies: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    refundForReview: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    airbnbReimbursement: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    luxuryLodgingReimbursement: number;

    @Column({
        type: "enum",
        enum: PotentialReviewIssue,
        default: PotentialReviewIssue.UNSET
    })
    potentialReviewIssue: PotentialReviewIssue;

    @Column({
        type: "enum",
        enum: CompletionStatus,
        default: CompletionStatus.NOT_STARTED
    })
    completionStatus: CompletionStatus;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
} 